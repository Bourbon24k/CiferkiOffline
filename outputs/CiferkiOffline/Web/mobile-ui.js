(function(root){
 'use strict';
 function initialTheme(saved){return saved==='light'?'light':'dark';}
 function backDestination(path){
  if(path==='/')return null;
  if(/^\/numbers\//.test(path))return '/collection';
  if(/^\/phones\//.test(path)&&path!=='/phones/mine')return '/phones/mine';
  if(/^\/games\/coin\//.test(path))return '/games?game=coin';
  if(/^\/games\/dice\//.test(path))return '/games?game=dice';
  if(/^\/games\//.test(path))return '/games';
  return '/';
 }
 function mount(app,events,backHandlers){
  const bar=document.createElement('nav');bar.className='mobile-chrome';bar.setAttribute('aria-label','Навигация и тема');
  bar.innerHTML='<button type="button" data-mobile-back aria-label="Назад"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m14 6-6 6 6 6"/></svg><span>Назад</span></button><div class="mobile-brand"><b>Циферки</b><span>Офлайн</span></div><button type="button" data-mobile-theme></button>';
  document.body.appendChild(bar);
  const back=bar.querySelector('[data-mobile-back]'),theme=bar.querySelector('[data-mobile-theme]');
  function updateBack(){back.disabled=location.pathname==='/';back.style.visibility=back.disabled?'hidden':'visible';}
  function setTheme(value){
   const scheme=initialTheme(value);app.colorScheme=scheme;localStorage.setItem('ciferki.theme',scheme);document.documentElement.dataset.theme=scheme;
   const target=scheme==='dark'?'светлую':'тёмную';theme.setAttribute('aria-label','Включить '+target+' тему');theme.title='Включить '+target+' тему';theme.setAttribute('aria-pressed',String(scheme==='dark'));
   theme.innerHTML=scheme==='dark'?'<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/></svg>':'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 15.2A8.6 8.6 0 0 1 8.8 4 8.6 8.6 0 1 0 20 15.2Z"/></svg>';
   events.get('themeChanged')?.forEach(fn=>fn());
   root.webkit?.messageHandlers.theme?.postMessage({scheme,color:scheme==='dark'?'#000000':'#f2f2f7'});
  }
  theme.onclick=()=>setTheme(app.colorScheme==='dark'?'light':'dark');
  function goBack(){
   if(document.querySelector('[aria-modal="true"]')){document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));return;}
   if(location.pathname==='/')return;
   if(Number(history.state?.idx)>0&&backHandlers.size){[...backHandlers].at(-1)();return;}
   const destination=backDestination(location.pathname);if(destination){history.replaceState({idx:0,key:'default',usr:null},'',destination);window.dispatchEvent(new PopStateEvent('popstate'));}
  }
  back.onclick=goBack;
  for(const method of ['pushState','replaceState']){const original=history[method].bind(history);history[method]=function(...args){const value=original(...args);queueMicrotask(updateBack);return value;};}
  window.addEventListener('popstate',updateBack);
  document.documentElement.style.setProperty('--tg-content-safe-area-inset-top','52px');
  setTheme(app.colorScheme);updateBack();
  root.CiferkiMobile={initialTheme,backDestination,setTheme,goBack,updateBack};
 }
 root.CiferkiMobile={initialTheme,backDestination,mount};
 if(typeof module!=='undefined')module.exports={initialTheme,backDestination};
})(globalThis);
