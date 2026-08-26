import { handleRequest } from "../server.mjs";

export default async function handler(req, res) {
  // Vercel calls this with Node's req/res. Netlify invokes functions with an
  // event object, so adapt it while keeping the shared server implementation.
  if (req && typeof req.httpMethod === "string") {
    const event = req;
    let response = { statusCode: 200, headers: {}, body: "" };
    const nodeReq = {
      method: event.httpMethod,
      url: event.rawUrl || event.path || "/",
      headers: event.headers || {},
      async *[Symbol.asyncIterator]() {
        if (event.body) yield Buffer.from(event.body, event.isBase64Encoded ? "base64" : "utf8");
      }
    };
    const nodeRes = {
      writeHead(statusCode, headers) { response.statusCode = statusCode; response.headers = headers; },
      end(body = "") { response.body = Buffer.isBuffer(body) ? body.toString("base64") : String(body); }
    };
    await handleRequest(nodeReq, nodeRes);
    return { ...response, isBase64Encoded: false };
  }
  return handleRequest(req, res);
}
