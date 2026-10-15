const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

Deno.serve((request) => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  const requestId = crypto.randomUUID()
  if (request.method !== 'GET' && request.method !== 'POST') {
    return jsonResponse({ ok: false, requestId, error: 'Method not allowed' }, 405)
  }

  return jsonResponse({
    ok: true,
    requestId,
    serverTime: new Date().toISOString(),
    region: Deno.env.get('SB_REGION') ?? 'unknown',
  })
})
