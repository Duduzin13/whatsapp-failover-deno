// WhatsApp Failover Worker – versão Deno Deploy
const GRAPH_URL = (id: string) => `https://graph.facebook.com/v19.0/${id}/messages`;

export default {
  async fetch(req: Request, env: Record<string, string>): Promise<Response> {
    const url = new URL(req.url);
    console.log(`🔹 [FETCH] ${req.method} ${url.pathname}`);

    // --- Validação do Meta (Webhook GET) ---
    if (url.pathname === "/webhook" && req.method === "GET") {
      const mode = url.searchParams.get("hub.mode");
      const token = url.searchParams.get("hub.verify_token");
      const challenge = url.searchParams.get("hub.challenge");

      if (mode === "subscribe" && token === "iptv_webhook_2024") {
        console.log("✅ Verificação bem-sucedida");
        return new Response(challenge, { status: 200 });
      }

      console.log("❌ Token inválido ou modo incorreto");
      return new Response("Forbidden", { status: 403 });
    }

    // --- Webhook POST ---
    if (url.pathname === "/webhook" && req.method === "POST") {
      let payload: any = {};
      try { payload = await req.json(); } catch {}
      const phones = extractPhones(payload);
      console.log(`📩 [WEBHOOK] Mensagem de ${phones.join(", ") || "N/D"}`);

      const healthy = await isOriginHealthy(env);
      console.log(`🩺 [HEALTH] Servidor está ${healthy ? "ONLINE ✅" : "OFFLINE ⚠️"}`);

      if (healthy) {
        try {
          const resp = await fetch(env.ORIGIN_WEBHOOK_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
          });
          console.log(`➡️ [FORWARD] Encaminhado (${resp.status})`);
          return new Response("OK", { status: 200 });
        } catch (e) {
          console.error("❌ [FORWARD] Falha:", e);
        }
      } else if (env.SEND_AUTOREPLY === "1") {
        for (const t of phones) {
          await sendWhatsApp(env, t, offlineMessage());
        }
      }

      return new Response("Accepted", { status: 202 });
    }

    // --- Teste manual (debug) ---
    if (url.pathname === "/_debug/testgraph") {
      const ok = await sendWhatsApp(env, "5511967512034", "🔧 Teste via Deno Deploy");
      return new Response(ok ? "✅ Enviado" : "❌ Falhou", { status: ok ? 200 : 500 });
    }

    // Resposta padrão
    return new Response("ok", { status: 200 });
  }
};

function extractPhones(payload: any): string[] {
  const out = new Set<string>();
  try {
    for (const e of payload.entry ?? [])
      for (const ch of e.changes ?? [])
        for (const m of ch.value.messages ?? [])
          if (m.from) out.add(m.from);
  } catch {}
  return [...out];
}

async function isOriginHealthy(env: Record<string, string>): Promise<boolean> {
  try {
    const r = await fetch(env.ORIGIN_HEALTH_URL, { method: "GET" });
    return r.ok;
  } catch {
    return false;
  }
}

async function sendWhatsApp(env: Record<string, string>, to: string, text: string): Promise<boolean> {
  try {
    const resp = await fetch(GRAPH_URL(env.PHONE_NUMBER_ID), {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${env.WHATSAPP_TOKEN}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to,
        type: "text",
        text: { body: text }
      })
    });
    console.log("[WHATSAPP]", resp.status);
    if (!resp.ok) {
      console.log(await resp.text());
      return false;
    }
    return true;
  } catch (e) {
    console.error("❌ [WHATSAPP] Erro:", e);
    return false;
  }
}

function offlineMessage(): string {
  return "⚠️ Estamos com instabilidade. Recebemos sua mensagem e avisaremos assim que tudo voltar ao normal.";
}
