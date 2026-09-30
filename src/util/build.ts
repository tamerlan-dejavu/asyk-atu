/** Информация о сборке: проверяющий видит, что деплой соответствует коммиту в репозитории. */
export const BUILD = {
  sha: typeof __BUILD_SHA__ === 'string' ? __BUILD_SHA__ : 'dev',
  time: typeof __BUILD_TIME__ === 'string' ? __BUILD_TIME__ : '',
};

export function logBuild(): void {
  console.info(`Asyk Atu ${BUILD.sha} built ${BUILD.time}`);
}
