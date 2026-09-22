// Consent for the one optional thing on this site: the host's visitor statistics
// (Lovable's analytics script, /~flock.js, which the host injects into every page).
// We cannot remove that script, so GATE_SCRIPT runs first, inline in <head> (the
// consentGate plugin in vite.config.ts puts it there), and holds it: until the
// visitor chooses "Accept all" it may neither write its session-id cookie nor send
// a report to /~api/analytics. The choice is stored in localStorage, which is
// strictly necessary to remember it (§ 25 (2) TDDDG).
// Same mechanism as teachitonce.com (MichaelZelbel/teach-it-once, src/lib/consent.ts).

export const CONSENT_KEY = "menerio-consent";
export const CONSENT_EVENT = "menerio-consent-open";
export type Consent = "all" | "essential";

export const GATE_SCRIPT = `(function(){
var K=${JSON.stringify(CONSENT_KEY)};
function ok(){try{return localStorage.getItem(K)==="all"}catch(e){return false}}
var A="/~api/analytics";
try{
var d=Object.getOwnPropertyDescriptor(Document.prototype,"cookie");
Object.defineProperty(document,"cookie",{configurable:true,
get:function(){return d.get.call(document)},
set:function(v){v=String(v);if(!ok()&&/^\\s*session-id=/.test(v)&&!/max-age=0/i.test(v))return;d.set.call(document,v)}});
}catch(e){}
var X=XMLHttpRequest.prototype,o=X.open,s=X.send;
X.open=function(m,u){this.__menStat=String(u).indexOf(A)!==-1;return o.apply(this,arguments)};
X.send=function(){if(this.__menStat&&!ok())return;return s.apply(this,arguments)};
if(window.fetch){var f=window.fetch;window.fetch=function(i){var u=typeof i==="string"?i:(i&&i.url)||"";if(String(u).indexOf(A)!==-1&&!ok())return Promise.resolve(new Response(null,{status:204}));return f.apply(this,arguments)}}
if(navigator.sendBeacon){var b=navigator.sendBeacon.bind(navigator);navigator.sendBeacon=function(u){if(String(u).indexOf(A)!==-1&&!ok())return true;return b.apply(null,arguments)}}
})();`;

export function readConsent(): Consent | null {
  try {
    const v = localStorage.getItem(CONSENT_KEY);
    return v === "all" || v === "essential" ? v : null;
  } catch {
    return null;
  }
}

export function saveConsent(choice: Consent) {
  try {
    localStorage.setItem(CONSENT_KEY, choice);
  } catch {
    // storage blocked: the banner simply asks again next time
  }
  if (choice === "essential") {
    // withdrawing is as easy as agreeing: drop the statistics cookie at once
    document.cookie = "session-id=; Max-Age=0; path=/; secure";
  }
}

export function openConsentSettings() {
  window.dispatchEvent(new Event(CONSENT_EVENT));
}
