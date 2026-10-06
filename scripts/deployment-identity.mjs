const OWNER = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/u;
const REPO = /^[A-Za-z0-9._-]{1,100}$/u;
const SHA = /^[a-f0-9]{40}$/iu;
const HOST = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.vercel\.app$/iu;

export function deploymentIdentity(env, config) {
  const owner = env.VERCEL_GIT_REPO_OWNER;
  const repo = env.VERCEL_GIT_REPO_SLUG;
  const commit = env.VERCEL_GIT_COMMIT_SHA;
  const host = env.VERCEL_URL;
  if (env.VERCEL_GIT_PROVIDER !== 'github' || !OWNER.test(owner || '')
      || !REPO.test(repo || '') || repo === '.' || repo === '..'
      || repo.toLowerCase().endsWith('.git') || !SHA.test(commit || '')
      || !HOST.test(host || '') || !Number.isInteger(config?.step) || config.step < 1 || config.step > 12
      || typeof config.judgeIssuer !== 'string'
      || !/^https:\/\/[a-z0-9-]+\.up\.railway\.app\/defense\/judge$/iu.test(config.judgeIssuer)
      || typeof config.sampleMarker !== 'string'
      || !/^[A-Z0-9_]{1,80}$/u.test(config.sampleMarker)) {
    throw new Error('배포 식별 정보를 확인할 수 없습니다. Vercel 시스템 환경변수와 aleph.config.json의 step을 확인하세요.');
  }
  return {
    schema: 'aleph.defense.deployment.v1',
    step: config.step,
    repoUrl: `https://github.com/${owner.toLowerCase()}/${repo.toLowerCase()}`,
    commit: commit.toLowerCase(),
    publicAppUrl: `https://${host.toLowerCase()}`,
    judgeIssuer: config.judgeIssuer,
    sampleMarker: config.sampleMarker,
    ...stageFields(config),
  };
}

const ROUTE = /^(?:GET|POST|PUT|PATCH|DELETE) \/[A-Za-z0-9/_:.-]{0,200}$/u;

// 3단계부터의 허용 경로·로그인 발급자와 5단계부터의 원본 API 주소를 심판이 /aleph.json에서 읽도록 옮깁니다.
// 설정에 없으면 넣지 않고, 형식이 틀리면 빈 값을 내보내지 않도록 빌드를 멈춥니다. 비밀값은 다루지 않습니다.
function stageFields(config) {
  const fields = {};
  if (config.allowedRoutes !== undefined && !(Array.isArray(config.allowedRoutes) && !config.allowedRoutes.length)) {
    if (!Array.isArray(config.allowedRoutes) || config.allowedRoutes.length > 50
        || config.allowedRoutes.some(route => typeof route !== 'string' || !ROUTE.test(route))) {
      throw new Error('aleph.config.json의 allowedRoutes는 "GET /api/notes" 같은 경로 문자열 배열이어야 합니다.');
    }
    fields.allowedRoutes = [...config.allowedRoutes];
  }
  if (config.identityProvider !== undefined && config.identityProvider !== null) {
    const provider = config.identityProvider;
    const https = value => {
      try { return new URL(value).protocol === 'https:'; } catch { return false; }
    };
    if (typeof provider !== 'object' || Array.isArray(provider)
        || !https(provider.issuer) || !https(provider.jwksUrl)
        || typeof provider.audience !== 'string' || !/^[a-zA-Z0-9._:-]{1,120}$/u.test(provider.audience)) {
      throw new Error('aleph.config.json의 identityProvider에 https issuer·jwksUrl과 audience가 필요합니다.');
    }
    // 공개 정보인 세 항목만 그대로 옮깁니다. 다른 항목은 내보내지 않습니다.
    fields.identityProvider = {
      issuer: provider.issuer, audience: provider.audience, jwksUrl: provider.jwksUrl,
    };
  }
  if (config.originalApiUrl !== undefined && config.originalApiUrl !== null) {
    let url;
    try { url = new URL(config.originalApiUrl); } catch { url = null; }
    if (!url || url.protocol !== 'https:' || url.username || url.password || url.search || url.hash
        || url.href !== config.originalApiUrl) {
      throw new Error('aleph.config.json의 originalApiUrl은 쿼리 없는 https 주소여야 합니다.');
    }
    fields.originalApiUrl = config.originalApiUrl;
  }
  return fields;
}
