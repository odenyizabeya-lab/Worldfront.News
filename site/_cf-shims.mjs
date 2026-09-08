export const sockets = {
  connect() {
    throw new Error('cloudflare:sockets unavailable in this harness');
  }
};

export default {};