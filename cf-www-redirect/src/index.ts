export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const apex = `https://litlabs.net${url.pathname}${url.search}`;
    return new Response(null, {
      status: 301,
      headers: {
        Location: apex,
        "Cache-Control": "public, max-age=86400",
      },
    });
  },
};
