const api=globalThis.browser||globalThis.chrome;
const DEFAULTS={backendUrl:'',mobileToken:'',translator:'kimi_subscription',domain:'auto',translationMode:'professional'};
async function settings(){const stored=await api.storage.local.get('safariSettings');return{...DEFAULTS,...(stored.safariSettings||{})}}
api.runtime.onMessage.addListener(async message=>{
  if(message?.type==='settings:get')return{ok:true,settings:await settings()};
  if(message?.type==='settings:save'){const next={...DEFAULTS,...message.settings};await api.storage.local.set({safariSettings:next});return{ok:true,settings:next}}
  if(message?.type==='knowledge:get'){const stored=await api.storage.local.get('mobileKnowledge');return{ok:true,records:stored.mobileKnowledge||[]}}
  if(message?.type==='knowledge:clear'){await api.storage.local.remove('mobileKnowledge');return{ok:true}}
  if(message?.type==='translate'){
    const cfg=await settings();
    if(!cfg.backendUrl)throw new Error('请先设置电脑翻译服务地址');
    const offline=message.offline===true||cfg.translationMode==='offline';
    const translator=message.translator||(offline?'nllb':cfg.translator);
    const response=await fetch(`${cfg.backendUrl.replace(/\/$/,'')}/translate`,{method:'POST',headers:{'Content-Type':'application/json','X-QS-Token':cfg.mobileToken||''},body:JSON.stringify({text:message.source,sourceLang:message.sourceLang||'auto',targetLang:'zh',domain:cfg.domain,translator,context:message.context||'',offline})});
    const data=await response.json();
    if(!response.ok)throw new Error(data.detail||`HTTP ${response.status}`);
    if(!message.preview){
      const record={source:message.source,translation:data.text,provider:translator,domain:cfg.domain,url:message.url||'',mediaTime:message.mediaTime??null,createdAt:new Date().toISOString()};
      const stored=await api.storage.local.get('mobileKnowledge');
      const records=[...(stored.mobileKnowledge||[]),record].slice(-1000);
      await api.storage.local.set({mobileKnowledge:records});
    }
    return{ok:true,text:data.text,provider:translator};
  }
});

api.action.onClicked.addListener(async tab=>{
  if(!tab?.id)return;
  await api.tabs.sendMessage(tab.id,{type:'floating:toggle'}).catch(()=>{});
});
