import { timingSafeEqual } from "node:crypto";
import { createServer as createHttp, type IncomingMessage, type ServerResponse } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { Discord } from "./discord.js";
import { createServer, type Options } from "./server.js";

export const authorized = (header: string | undefined, token: string) => {
  const given = Buffer.from(header?.replace(/^Bearer\s+/i, "") ?? "");
  const want = Buffer.from(token);
  return want.length > 0 && given.length === want.length && timingSafeEqual(given, want);
};

const send = (res: ServerResponse, status: number, body: unknown) =>
  res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(body));

const MAX_BODY_BYTES = 1024 * 1024;
class BodyTooLarge extends Error {}

async function readJson(req: IncomingMessage) {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > MAX_BODY_BYTES) throw new BodyTooLarge();
    chunks.push(c as Buffer);
  }
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : undefined;
}

export interface HttpOptions extends Options {
  /** Bearer token required on /mcp. Unset on AgentCore: the Gateway handles auth. */
  authToken?: string;
}

/**
 * Stateless Streamable HTTP MCP server on /mcp, as AgentCore Runtime expects.
 * One MCP server per request, JSON responses only.
 */
export function createHttpServer(discord: Discord, opts: HttpOptions = {}) {
  return createHttp(async (req, res) => {
    const path = new URL(req.url ?? "/", "http://localhost").pathname;
    if (path === "/ping") return send(res, 200, { status: "Healthy" });
    if (path !== "/mcp") return send(res, 404, { error: "not found" });
    if (opts.authToken && !authorized(req.headers.authorization, opts.authToken)) {
      return send(res, 401, { error: "unauthorized" });
    }
    if (req.method !== "POST") return send(res, 405, { error: "method not allowed" });

    let body: unknown;
    try {
      body = await readJson(req);
    } catch (e) {
      if (e instanceof BodyTooLarge) {
        res.setHeader("connection", "close");
        return send(res, 413, { error: "payload too large" });
      }
      return send(res, 400, { jsonrpc: "2.0", error: { code: -32700, message: "Parse error" }, id: null });
    }

    const server = createServer(discord, opts);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on("close", () => {
      void transport.close();
      void server.close();
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, body);
    } catch (e) {
      console.error(e);
      if (!res.headersSent) send(res, 500, { jsonrpc: "2.0", error: { code: -32603, message: "Internal error" }, id: null });
    }
  });
}
