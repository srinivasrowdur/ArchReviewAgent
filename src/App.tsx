import { useEffect, useState, useTransition } from 'react';
import type {
  EnterpriseReadinessReport,
  GuardrailAssessment,
  ResearchProgressStage,
  ResearchResponse
} from '../shared/contracts';
import {
  criticalGuardrails,
  liveResearchStages,
  type ResearchProgressUpdate
} from '../shared/contracts';

const isTestMode =
  new URLSearchParams(window.location.search).get('mode') === 'test';
const conversationStorageKey = `archreviewagent.conversations.${isTestMode ? 'test' : 'live'}`;
const maxStoredConversations = 40;
const dateFormatter = new Intl.DateTimeFormat('en-GB', {
  dateStyle: 'medium',
  timeStyle: 'short'
});

type Message = {
  id: string;
  role: 'assistant' | 'user';
  content: string;
  report?: EnterpriseReadinessReport;
  isError?: boolean;
};

type ConversationRecord = {
  id: string;
  createdAt: string;
  updatedAt: string;
  messages: Message[];
};

type ConversationState = {
  conversations: ConversationRecord[];
  activeConversationId: string;
};

type PendingAssistantMessage = {
  conversationId: string;
  message: Message;
};

const initialMessages: Message[] = [
  {
    id: 'welcome',
    role: 'assistant',
    content:
      isTestMode
        ? 'Test mode is enabled. Enter a company or product name and I will return a fast mocked security review so you can verify the experience.'
        : 'Enter a company or product name. I will assess EU data residency and enterprise deployment as a security analyst, make a decision from the evidence, and attach a confidence level.'
  }
];

export default function App() {
  const [companyName, setCompanyName] = useState('');
  const [conversationState, setConversationState] = useState<ConversationState>(() =>
    loadConversationState()
  );
  const [isLoading, setIsLoading] = useState(false);
  const [reportedResearchStage, setReportedResearchStage] =
    useState<ResearchProgressStage | null>(null);
  const [visibleResearchStage, setVisibleResearchStage] =
    useState<ResearchProgressStage | null>(null);
  const [pendingAssistantMessage, setPendingAssistantMessage] =
    useState<PendingAssistantMessage | null>(null);
  const [, startTransition] = useTransition();
  const trimmedCompanyName = companyName.trim();
  const activeConversation = findActiveConversation(
    conversationState.conversations,
    conversationState.activeConversationId
  );
  const messages = activeConversation.messages;
  const activeConversationTitle = getConversationTitle(activeConversation);

  useEffect(() => {
    saveConversationState(conversationState);
  }, [conversationState]);

  useEffect(() => {
    if (!isLoading || !reportedResearchStage || !visibleResearchStage) {
      return;
    }

    const visibleIndex = findResearchStageIndex(visibleResearchStage);
    const reportedIndex = findResearchStageIndex(reportedResearchStage);

    if (visibleIndex === -1 || reportedIndex === -1 || reportedIndex <= visibleIndex) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      const nextStage = liveResearchStages[visibleIndex + 1];

      if (nextStage) {
        setVisibleResearchStage(nextStage.stage);
      }
    }, visibleResearchStage === 'starting' ? 420 : 680);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [isLoading, reportedResearchStage, visibleResearchStage]);

  useEffect(() => {
    if (!pendingAssistantMessage || visibleResearchStage !== 'finalizing') {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      startTransition(() => {
        setConversationState((current) =>
          appendMessagesToConversation(current, pendingAssistantMessage.conversationId, [
            pendingAssistantMessage.message
          ])
        );
      });
      setPendingAssistantMessage(null);
      resetResearchProgress();
    }, 340);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [pendingAssistantMessage, startTransition, visibleResearchStage]);

  function resetResearchProgress() {
    setIsLoading(false);
    setReportedResearchStage(null);
    setVisibleResearchStage(null);
  }

  function handleCreateConversation() {
    if (isLoading || isConversationEmpty(activeConversation)) {
      return;
    }

    setConversationState((current) => {
      const nextConversation = createConversationRecord();

      return {
        conversations: [nextConversation, ...current.conversations].slice(
          0,
          maxStoredConversations
        ),
        activeConversationId: nextConversation.id
      };
    });
    setCompanyName('');
  }

  function handleSelectConversation(conversationId: string) {
    if (isLoading || conversationId === conversationState.activeConversationId) {
      return;
    }

    setConversationState((current) => ({
      ...current,
      activeConversationId: conversationId
    }));
    setCompanyName('');
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const nextCompany = companyName.trim();
    const activeConversationId = activeConversation.id;

    if (!nextCompany || isLoading) {
      return;
    }

    setConversationState((current) =>
      appendMessagesToConversation(current, activeConversationId, [
        {
          id: crypto.randomUUID(),
          role: 'user',
          content: nextCompany
        }
      ])
    );
    setCompanyName('');
    setIsLoading(true);
    setPendingAssistantMessage(null);
    setReportedResearchStage(isTestMode ? null : 'starting');
    setVisibleResearchStage(isTestMode ? null : 'starting');

    try {
      const payload = isTestMode
        ? await requestResearch('/api/chat/test', nextCompany)
        : await requestStreamedResearch(nextCompany, (update) => {
            setReportedResearchStage(update.stage);
          });

      const nextAssistantMessage = {
        id: crypto.randomUUID(),
        role: 'assistant' as const,
        content: payload.report.executiveSummary,
        report: payload.report
      };

      if (isTestMode) {
        startTransition(() => {
          setConversationState((current) =>
            appendMessagesToConversation(current, activeConversationId, [
              nextAssistantMessage
            ])
          );
        });
        resetResearchProgress();
        return;
      }

      setReportedResearchStage('finalizing');
      setPendingAssistantMessage({
        conversationId: activeConversationId,
        message: nextAssistantMessage
      });
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'Unexpected UI error while loading research.';

      setConversationState((current) =>
        appendMessagesToConversation(current, activeConversationId, [
          {
            id: crypto.randomUUID(),
            role: 'assistant',
            content: message,
            isError: true
          }
        ])
      );
      setPendingAssistantMessage(null);
      resetResearchProgress();
    }
  }

  return (
    <div className="app-shell">
      <aside className="signal-rail">
        <div className="signal-block hero-block">
          <p className="eyebrow">Security Analyst</p>
          <h1>Third-party risk review before enterprise adoption.</h1>
          <p className="lead-copy">
            This analyst agent makes a decision from primary vendor evidence on
            EU data residency and enterprise deployment, then attaches a
            confidence level to the conclusion.
          </p>
          {isTestMode ? (
            <p className="mode-banner">Test mode: mocked report path enabled.</p>
          ) : null}
        </div>

        <div className="signal-block">
          <p className="section-label">Current query</p>
          <p className="live-query">
            {trimmedCompanyName ||
              (isConversationEmpty(activeConversation)
                ? 'Waiting for a vendor name'
                : activeConversationTitle)}
          </p>
        </div>

        <div className="signal-block">
          <div className="history-header">
            <p className="section-label">History</p>
            <button
              className="history-action"
              disabled={isLoading || isConversationEmpty(activeConversation)}
              onClick={handleCreateConversation}
              type="button"
            >
              New
            </button>
          </div>
          <div className="history-list" role="list" aria-label="Conversation history">
            {conversationState.conversations.map((conversation) => (
              <ConversationListItem
                active={conversation.id === conversationState.activeConversationId}
                conversation={conversation}
                disabled={isLoading}
                key={conversation.id}
                onSelect={handleSelectConversation}
              />
            ))}
          </div>
        </div>

        <div className="signal-block">
          <p className="section-label">Guardrails</p>
          <div className="guardrail-list">
            {criticalGuardrails.map((guardrail) => (
              <article className="guardrail-item" key={guardrail.key}>
                <h2>{guardrail.label}</h2>
                <p>{guardrail.description}</p>
              </article>
            ))}
          </div>
        </div>
      </aside>

      <main className="workspace">
        <header className="workspace-header">
          <div>
            <p className="eyebrow">Research Workspace</p>
            <h2>Chat with a security-focused vendor review agent.</h2>
          </div>
          <p className="workspace-note">
            {isTestMode
              ? 'Fast local validation path. Results are mocked so you can test the UI without waiting on live research.'
              : 'This view streams the analyst workflow live and only says unknown when the public data is genuinely too thin.'}
          </p>
        </header>

        <section className="chat-surface">
          <div className="message-stream" aria-live="polite">
            {messages.map((message) => (
              <MessageBubble key={message.id} message={message} />
            ))}

            {isLoading ? (
              <LoadingMessage
                activeStage={visibleResearchStage}
                isTestMode={isTestMode}
              />
            ) : null}
          </div>

          <form className="composer" onSubmit={handleSubmit}>
            <label className="composer-label" htmlFor="companyName">
              Company or product name
            </label>
            <div className="composer-row">
              <input
                id="companyName"
                name="companyName"
                value={companyName}
                onChange={(event) => setCompanyName(event.target.value)}
                placeholder="e.g. Notion, Databricks, Miro"
                autoComplete="off"
              />
              <button disabled={isLoading} type="submit">
                {isLoading
                  ? isTestMode
                    ? 'Loading sample...'
                    : 'Researching...'
                  : isTestMode
                    ? 'Run sample'
                    : 'Run guardrail'}
              </button>
            </div>
          </form>
        </section>
      </main>
    </div>
  );
}

async function requestResearch(endpoint: string, companyName: string) {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      companyName
    })
  });

  const payload = (await response.json()) as ResearchResponse | { error?: string };

  if (!response.ok || !('report' in payload)) {
    throw new Error(payload.error ?? 'Research request failed.');
  }

  return payload;
}

async function requestStreamedResearch(
  companyName: string,
  onProgress: (update: ResearchProgressUpdate) => void
) {
  const response = await fetch('/api/chat/stream', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      companyName
    })
  });

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { error?: string } | null;

    throw new Error(payload?.error ?? 'Research request failed.');
  }

  if (!response.body) {
    throw new Error('Streaming is not available in this browser.');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let finalPayload: ResearchResponse | null = null;

  while (true) {
    const { done, value } = await reader.read();

    buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done }).replace(/\r/g, '');

    let boundaryIndex = buffer.indexOf('\n\n');

    while (boundaryIndex !== -1) {
      const rawEvent = buffer.slice(0, boundaryIndex).trim();

      buffer = buffer.slice(boundaryIndex + 2);

      if (rawEvent) {
        const parsedEvent = parseStreamEvent(rawEvent);

        if (parsedEvent.event === 'progress') {
          onProgress(parsedEvent.data as ResearchProgressUpdate);
        }

        if (parsedEvent.event === 'result') {
          finalPayload = parsedEvent.data as ResearchResponse;
        }

        if (parsedEvent.event === 'error') {
          const payload = parsedEvent.data as { error?: string };

          throw new Error(payload.error ?? 'Research request failed.');
        }
      }

      boundaryIndex = buffer.indexOf('\n\n');
    }

    if (done) {
      break;
    }
  }

  if (!finalPayload) {
    throw new Error('Research stream ended before a report was returned.');
  }

  return finalPayload;
}

function parseStreamEvent(rawEvent: string) {
  let event = 'message';
  const dataLines: string[] = [];

  for (const line of rawEvent.split('\n')) {
    if (line.startsWith('event:')) {
      event = line.slice(6).trim();
    } else if (line.startsWith('data:')) {
      dataLines.push(line.slice(5).trimStart());
    }
  }

  return {
    event,
    data: JSON.parse(dataLines.join('\n') || 'null') as unknown
  };
}

function LoadingMessage({
  activeStage,
  isTestMode
}: {
  activeStage: ResearchProgressStage | null;
  isTestMode: boolean;
}) {
  const currentStage =
    liveResearchStages.find((stage) => stage.stage === activeStage) ??
    liveResearchStages[0];
  const activeIndex = isTestMode
    ? -1
    : liveResearchStages.findIndex((stage) => stage.stage === currentStage.stage);

  return (
    <div className="message assistant progress-message">
      <div className="message-meta">agent</div>
      <p className="message-copy">
        {isTestMode ? 'Loading mocked security review.' : currentStage.label}
      </p>

      <div className="typing-indicator" aria-label="Research in progress">
        <span />
        <span />
        <span />
      </div>

      {!isTestMode ? (
        <ol className="progress-list">
          {liveResearchStages.map((stage, index) => {
            const state =
              index < activeIndex
                ? 'done'
                : index === activeIndex
                  ? 'active'
                  : 'pending';

            return (
              <li className={`progress-step ${state}`} key={stage.stage}>
                <span className="progress-marker" aria-hidden="true" />
                <span>{stage.label}</span>
              </li>
            );
          })}
        </ol>
      ) : null}
    </div>
  );
}

function findResearchStageIndex(stage: ResearchProgressStage) {
  return liveResearchStages.findIndex((item) => item.stage === stage);
}

function ConversationListItem({
  active,
  conversation,
  disabled,
  onSelect
}: {
  active: boolean;
  conversation: ConversationRecord;
  disabled: boolean;
  onSelect: (conversationId: string) => void;
}) {
  const latestReport = getLatestReport(conversation);

  return (
    <button
      aria-pressed={active}
      className={`history-item${active ? ' active' : ''}`}
      disabled={disabled}
      onClick={() => onSelect(conversation.id)}
      type="button"
    >
      <div className="history-item-topline">
        <strong>{getConversationTitle(conversation)}</strong>
        {latestReport ? <StatusPill label={latestReport.recommendation} subtle /> : null}
      </div>
      <p>{getConversationPreview(conversation)}</p>
      <small>{formatDate(conversation.updatedAt)}</small>
    </button>
  );
}

function MessageBubble({ message }: { message: Message }) {
  return (
    <article
      className={`message ${message.role}${message.isError ? ' error' : ''}`}
    >
      <div className="message-meta">
        {message.role === 'assistant' ? 'agent' : 'user'}
      </div>
      <p className="message-copy">{message.content}</p>
      {message.report ? <ReportView report={message.report} /> : null}
    </article>
  );
}

function ReportView({ report }: { report: EnterpriseReadinessReport }) {
  return (
    <div className="report">
      <div className="report-topline">
        <StatusPill label={report.recommendation} />
        <span>{formatDate(report.researchedAt)}</span>
      </div>

      <div className="report-overview">
        <h3>{report.companyName}</h3>
        <p>{report.overview}</p>
      </div>

      <section className="guardrail-grid">
        <GuardrailCard
          title="EU data residency"
          assessment={report.guardrails.euDataResidency}
        />
        <GuardrailCard
          title="Enterprise deployment"
          assessment={report.guardrails.enterpriseDeployment}
        />
      </section>

      <section className="report-detail">
        <div>
          <p className="section-label">Deployment verdict</p>
          <p>{report.deploymentVerdict}</p>
        </div>
        <div>
          <p className="section-label">Open questions</p>
          <ul>
            {report.unansweredQuestions.length > 0 ? (
              report.unansweredQuestions.map((item) => <li key={item}>{item}</li>)
            ) : (
              <li>No major unanswered questions were surfaced.</li>
            )}
          </ul>
        </div>
        <div>
          <p className="section-label">Suggested next steps</p>
          <ul>
            {report.nextSteps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ul>
        </div>
      </section>
    </div>
  );
}

function GuardrailCard({
  title,
  assessment
}: {
  title: string;
  assessment: GuardrailAssessment;
}) {
  return (
    <article className="guardrail-card">
      <div className="guardrail-card-header">
        <h4>{title}</h4>
        <StatusPill label={assessment.status} subtle />
      </div>
      <p>{assessment.summary}</p>
      <p className="confidence-line">Confidence: {assessment.confidence}</p>

      <ul>
        {assessment.risks.map((risk) => (
          <li key={risk}>{risk}</li>
        ))}
      </ul>

      <div className="evidence-list">
        {assessment.evidence.map((item) => (
          <a
            className="evidence-link"
            href={item.url}
            key={`${item.url}-${item.title}`}
            rel="noreferrer"
            target="_blank"
          >
            <span>{item.title}</span>
            <small>
              {item.publisher} · {item.sourceType}
            </small>
            <strong>{item.finding}</strong>
          </a>
        ))}
      </div>
    </article>
  );
}

function StatusPill({
  label,
  subtle = false
}: {
  label: string;
  subtle?: boolean;
}) {
  const slug = label.toLowerCase().replace(/\s+/g, '-');

  return (
    <span className={`status-pill ${slug}${subtle ? ' subtle' : ''}`}>
      {label}
    </span>
  );
}

function formatDate(value: string) {
  const parsed = new Date(value);

  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return dateFormatter.format(parsed);
}

function loadConversationState(): ConversationState {
  const fallbackConversation = createConversationRecord();

  try {
    const raw = window.localStorage.getItem(conversationStorageKey);

    if (!raw) {
      return {
        conversations: [fallbackConversation],
        activeConversationId: fallbackConversation.id
      };
    }

    const parsed = JSON.parse(raw) as Partial<ConversationState>;
    const conversations = Array.isArray(parsed.conversations)
      ? sortConversations(
          parsed.conversations.filter(isConversationRecord).map(normalizeConversation)
        ).slice(0, maxStoredConversations)
      : [];

    if (conversations.length === 0) {
      return {
        conversations: [fallbackConversation],
        activeConversationId: fallbackConversation.id
      };
    }

    const activeConversationId =
      typeof parsed.activeConversationId === 'string' &&
      conversations.some((conversation) => conversation.id === parsed.activeConversationId)
        ? parsed.activeConversationId
        : conversations[0].id;

    return {
      conversations,
      activeConversationId
    };
  } catch {
    return {
      conversations: [fallbackConversation],
      activeConversationId: fallbackConversation.id
    };
  }
}

function saveConversationState(state: ConversationState) {
  try {
    window.localStorage.setItem(
      conversationStorageKey,
      JSON.stringify({
        ...state,
        conversations: state.conversations.slice(0, maxStoredConversations)
      })
    );
  } catch {
    // Ignore storage failures so the chat remains usable in restricted browsers.
  }
}

function createConversationRecord(): ConversationRecord {
  const now = new Date().toISOString();

  return {
    id: crypto.randomUUID(),
    createdAt: now,
    updatedAt: now,
    messages: initialMessages.map((message) => ({ ...message }))
  };
}

function normalizeConversation(conversation: ConversationRecord): ConversationRecord {
  const createdAt = normalizeDateString(conversation.createdAt);
  const updatedAt = normalizeDateString(conversation.updatedAt);

  return {
    id: conversation.id,
    createdAt,
    updatedAt,
    messages:
      Array.isArray(conversation.messages) && conversation.messages.length > 0
        ? conversation.messages
        : initialMessages.map((message) => ({ ...message }))
  };
}

function normalizeDateString(value: string | undefined) {
  if (!value) {
    return new Date().toISOString();
  }

  const parsed = new Date(value);

  return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
}

function isConversationRecord(value: unknown): value is ConversationRecord {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as Partial<ConversationRecord>;

  return typeof candidate.id === 'string' && Array.isArray(candidate.messages);
}

function findActiveConversation(
  conversations: ConversationRecord[],
  activeConversationId: string
) {
  return (
    conversations.find((conversation) => conversation.id === activeConversationId) ??
    conversations[0] ??
    createConversationRecord()
  );
}

function appendMessagesToConversation(
  state: ConversationState,
  conversationId: string,
  messages: Message[]
): ConversationState {
  const timestamp = new Date().toISOString();
  const nextConversations = state.conversations.map((conversation) =>
    conversation.id === conversationId
      ? {
          ...conversation,
          updatedAt: timestamp,
          messages: [...conversation.messages, ...messages]
        }
      : conversation
  );

  return {
    activeConversationId: state.activeConversationId,
    conversations: sortConversations(nextConversations).slice(0, maxStoredConversations)
  };
}

function sortConversations(conversations: ConversationRecord[]) {
  return [...conversations].toSorted(
    (left, right) =>
      new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime()
  );
}

function isConversationEmpty(conversation: ConversationRecord) {
  return !conversation.messages.some((message) => message.role === 'user');
}

function getConversationTitle(conversation: ConversationRecord) {
  const firstUserMessage = conversation.messages.find((message) => message.role === 'user');

  return firstUserMessage?.content || 'New security review';
}

function getConversationPreview(conversation: ConversationRecord) {
  const lastMeaningfulMessage = findLastMessage(
    conversation.messages,
    (message) => message.role === 'assistant' || message.role === 'user'
  );

  return (
    lastMeaningfulMessage?.content ||
    'Start a new vendor review to persist results in this browser.'
  );
}

function getLatestReport(conversation: ConversationRecord) {
  return findLastMessage(conversation.messages, (message) => Boolean(message.report))?.report;
}

function findLastMessage(
  messages: Message[],
  predicate: (message: Message) => boolean
) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];

    if (predicate(message)) {
      return message;
    }
  }

  return undefined;
}
