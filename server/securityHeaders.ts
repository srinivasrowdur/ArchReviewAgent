import helmet from 'helmet';

const productionContentSecurityPolicyDirectives = {
  defaultSrc: ["'self'"],
  scriptSrc: ["'self'"],
  connectSrc: ["'self'"],
  styleSrc: ["'self'", 'https://fonts.googleapis.com'],
  fontSrc: ["'self'", 'https://fonts.gstatic.com'],
  imgSrc: ["'self'", 'data:'],
  objectSrc: ["'none'"],
  baseUri: ["'self'"],
  formAction: ["'self'"],
  frameAncestors: ["'none'"]
};

export function createSecurityHeadersMiddleware(nodeEnv = process.env.NODE_ENV) {
  return helmet({
    contentSecurityPolicy:
      nodeEnv === 'production'
        ? {
            directives: productionContentSecurityPolicyDirectives
          }
        : false,
    crossOriginEmbedderPolicy: false,
    frameguard: {
      action: 'deny'
    },
    referrerPolicy: {
      policy: 'no-referrer'
    }
  });
}

export function getProductionContentSecurityPolicyDirectives() {
  return productionContentSecurityPolicyDirectives;
}
