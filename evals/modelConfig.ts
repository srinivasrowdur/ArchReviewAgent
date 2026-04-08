export type EvalModelSetting = {
  value: string;
  source: 'EVAL_MODEL' | 'OPENAI_MODEL' | 'unset';
};

export function getEvalModelSetting(): EvalModelSetting {
  if (process.env.EVAL_MODEL?.trim()) {
    return {
      value: process.env.EVAL_MODEL.trim(),
      source: 'EVAL_MODEL'
    };
  }

  if (process.env.OPENAI_MODEL?.trim()) {
    return {
      value: process.env.OPENAI_MODEL.trim(),
      source: 'OPENAI_MODEL'
    };
  }

  return {
    value: 'gpt-5.4',
    source: 'unset'
  };
}
