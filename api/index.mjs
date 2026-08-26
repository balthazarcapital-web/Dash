const bases={deterlimp:["13Kmg41VDV8KUijPucj2TxCFdElFD6Vfb1WY4WwB7msU","1856239408"],carlos_bezerra:["1PE6KUaEEshp2Kk1d9eExIFp53DzNTJST7mJc4pMZEuw","1856239408"],clinica_gianna:["1_LTDwN25pSKXfofahLgFiRGndb79cWNHxi8iR3v_VHM","1856239408"],dr_clovis_cmfs:["1Myr3_i6bWDCI9dq--3x3ndH3QWqFfmdlKvE-YhRZ0lU","1856239408"]};
const json=(statusCode,body)=>new Response(JSON.stringify(body),{status:statusCode,headers:{"content-type":"application/json","cache-control":"no-store"}});
export default async function handler(event,res){
  if(res&&event&&typeof event.method==="string"){
    const out=await handler({httpMethod:event.method,rawUrl:`https://${event.headers?.host||"vercel.local"}${event.url||"/"}`,headers:event.headers||{}},null);
    res.writeHead(out.status,Object.fromEntries(out.headers.entries()));res.end(await out.text());return;
  }
  if(event&&((typeof event.httpMethod==="string")||typeof event.method==="string")){
    const modern=!res&&typeof event.method==="string";
    const url=new URL(modern?event.url:(event.rawUrl||event.path||"/"),"https://netlify.local");
    const connected=Boolean(process.env.GOOGLE_CLIENT_ID&&process.env.GOOGLE_CLIENT_SECRET&&process.env.GOOGLE_REFRESH_TOKEN);
    if(url.pathname==="/api/health") { const payload={ok:true,runtime:"netlify",driveConnected:connected}; return modern?new Response(JSON.stringify(payload),{status:200,headers:{"content-type":"application/json"}}):json(200,payload); }
    if(url.pathname==="/api/base"){
      const base=bases[String(url.searchParams.get("clientId")||"").toLowerCase()]; if(!base)return json(404,{error:"Base deste cliente não configurada."}); if(!connected)return json(503,{error:"Google Drive ainda não conectado na publicação."});
      try{const tr=await fetch("https://oauth2.googleapis.com/token",{method:"POST",headers:{"content-type":"application/x-www-form-urlencoded"},body:new URLSearchParams({client_id:process.env.GOOGLE_CLIENT_ID,client_secret:process.env.GOOGLE_CLIENT_SECRET,refresh_token:process.env.GOOGLE_REFRESH_TOKEN,grant_type:"refresh_token"})});const token=await tr.json();if(!tr.ok||!token.access_token)return json(502,{error:"Não foi possível autenticar no Google Drive."});const r=await fetch(`https://docs.google.com/spreadsheets/d/${base[0]}/export?format=csv&gid=${base[1]}`,{headers:{authorization:`Bearer ${token.access_token}`}});const text=await r.text();if(!r.ok)return json(r.status,{error:`Google Sheets retornou ${r.status}.`});return modern?new Response(text,{status:200,headers:{"content-type":"text/csv; charset=utf-8","cache-control":"private, no-store"}}):{statusCode:200,headers:{"content-type":"text/csv; charset=utf-8","cache-control":"private, no-store"},body:text};}catch{return json(502,{error:"Falha ao consultar o Google Drive."});}
    }
    return json(404,{error:"Endpoint não encontrado."});
  }
  return json(404,{error:"Endpoint não encontrado."});
}
