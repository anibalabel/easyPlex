export function wrapAsync(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

export function makeAsyncRouter(router) {
  for (const method of ['get', 'post', 'put', 'patch', 'delete', 'all']) {
    const orig = router[method].bind(router);
    router[method] = (path, ...handlers) => {
      const wrapped = handlers.map((h) =>
        typeof h === 'function' && h.length <= 3 ? wrapAsync(h) : h
      );
      return orig(path, ...wrapped);
    };
  }
  return router;
}
