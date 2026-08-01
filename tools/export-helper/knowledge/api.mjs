export function createKnowledgeApi(service) {
  return async function handleKnowledgeRequest(req, res, url, helpers) {
    if (!url.pathname.startsWith("/knowledge")) return false;
    const { readJsonBody, sendJson } = helpers;
    try {
      if (req.method === "GET" && url.pathname === "/knowledge") {
        sendJson(res, 200, { ok: true, items: service.list(Object.fromEntries(url.searchParams)) });
        return true;
      }
      if (req.method === "POST" && url.pathname === "/knowledge") {
        sendJson(res, 201, { ok: true, item: service.createManual(await readJsonBody(req)) });
        return true;
      }
      if (req.method === "POST" && url.pathname === "/knowledge/sessions") {
        sendJson(res, 201, { ok: true, session: service.createSession(await readJsonBody(req)) });
        return true;
      }
      const sessionMatch = url.pathname.match(/^\/knowledge\/sessions\/([^/]+)$/);
      if (sessionMatch && req.method === "GET") {
        const session = service.getSession(sessionMatch[1]);
        if (!session) sendJson(res, 404, { error: "Application session not found." });
        else sendJson(res, 200, { ok: true, session });
        return true;
      }
      if (sessionMatch && req.method === "PUT") {
        sendJson(res, 200, { ok: true, session: service.updateSession(sessionMatch[1], await readJsonBody(req)) });
        return true;
      }
      const sessionCandidates = url.pathname.match(/^\/knowledge\/sessions\/([^/]+)\/candidates$/);
      if (sessionCandidates && req.method === "GET") {
        sendJson(res, 200, { ok: true, candidates: service.repository.listCandidates(sessionCandidates[1], url.searchParams.get("status") || undefined) });
        return true;
      }
      const sessionUsage = url.pathname.match(/^\/knowledge\/sessions\/([^/]+)\/usage$/);
      if (sessionUsage && req.method === "POST") {
        sendJson(res, 201, { ok: true, usage: service.recordUsage(sessionUsage[1], await readJsonBody(req)) });
        return true;
      }
      if (sessionCandidates && req.method === "POST") {
        const body = await readJsonBody(req);
        sendJson(res, 201, { ok: true, candidates: service.createCandidates(sessionCandidates[1], body.candidates) });
        return true;
      }
      const retrieveMatch = url.pathname.match(/^\/knowledge\/sessions\/([^/]+)\/retrieve$/);
      if (retrieveMatch && req.method === "POST") {
        const body = await readJsonBody(req);
        sendJson(res, 200, { ok: true, ...service.retrieve(retrieveMatch[1], body.requirements) });
        return true;
      }
      const approveMatch = url.pathname.match(/^\/knowledge\/candidates\/([^/]+)\/approve$/);
      if (approveMatch && req.method === "POST") {
        sendJson(res, 200, { ok: true, ...service.approveCandidate(approveMatch[1], await readJsonBody(req)) });
        return true;
      }
      const rejectMatch = url.pathname.match(/^\/knowledge\/candidates\/([^/]+)\/reject$/);
      if (rejectMatch && req.method === "POST") {
        sendJson(res, 200, { ok: true, candidate: service.rejectCandidate(rejectMatch[1]) });
        return true;
      }
      const versionsMatch = url.pathname.match(/^\/knowledge\/([^/]+)\/versions$/);
      if (versionsMatch && req.method === "GET") {
        sendJson(res, 200, { ok: true, versions: service.versions(versionsMatch[1]) });
        return true;
      }
      const usageMatch = url.pathname.match(/^\/knowledge\/([^/]+)\/usage$/);
      if (usageMatch && req.method === "GET") {
        sendJson(res, 200, { ok: true, usage: service.usage(usageMatch[1]) });
        return true;
      }
      const statusMatch = url.pathname.match(/^\/knowledge\/([^/]+)\/status$/);
      if (statusMatch && req.method === "POST") {
        const body = await readJsonBody(req);
        sendJson(res, 200, { ok: true, item: service.setStatus(statusMatch[1], body.status) });
        return true;
      }
      const itemMatch = url.pathname.match(/^\/knowledge\/([^/]+)$/);
      if (itemMatch && req.method === "GET") {
        const item = service.get(itemMatch[1]);
        if (!item) sendJson(res, 404, { error: "Knowledge item not found." });
        else sendJson(res, 200, { ok: true, item });
        return true;
      }
      if (itemMatch && req.method === "PUT") {
        const body = await readJsonBody(req);
        sendJson(res, 200, { ok: true, item: service.update(itemMatch[1], body, body.change_reason) });
        return true;
      }
      sendJson(res, 404, { error: "Knowledge operation not found." });
    } catch (error) {
      sendJson(res, /not found/i.test(error?.message || "") ? 404 : 400,
        { error: error instanceof Error ? error.message : "Knowledge operation failed." });
    }
    return true;
  };
}
