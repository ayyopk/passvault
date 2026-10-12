// Exact crypto functions from the accepted v2.0 baseline; synthetic tests only.
const APP_VERSION="2.0",encoder=new TextEncoder(),decoder=new TextDecoder();
function bytesToB64(bytes){let s="";bytes.forEach(b=>s+=String.fromCharCode(b));return btoa(s)}
function b64ToBytes(s){return Uint8Array.from(atob(s),c=>c.charCodeAt(0))}
async function deriveKey(password,salt,iterations=250000){
  const base=await crypto.subtle.importKey("raw",encoder.encode(password),"PBKDF2",false,["deriveKey"]);
  return crypto.subtle.deriveKey({name:"PBKDF2",salt,iterations,hash:"SHA-256"},base,{name:"AES-GCM",length:256},false,["encrypt","decrypt"]);
}
async function encryptVault(data,password){
  const salt=crypto.getRandomValues(new Uint8Array(16)),iv=crypto.getRandomValues(new Uint8Array(12));
  const iterations=250000,key=await deriveKey(password,salt,iterations);
  const plain=encoder.encode(JSON.stringify(data));
  const cipher=new Uint8Array(await crypto.subtle.encrypt({name:"AES-GCM",iv},key,plain));
  return {format:"passvault",schemaVersion:1,appVersion:APP_VERSION,kdf:"PBKDF2-SHA256",iterations,
    cipher:"AES-GCM",salt:bytesToB64(salt),iv:bytesToB64(iv),data:bytesToB64(cipher)};
}
async function decryptVault(payload,password){
  const key=await deriveKey(password,b64ToBytes(payload.salt),payload.iterations||250000);
  const plain=await crypto.subtle.decrypt({name:"AES-GCM",iv:b64ToBytes(payload.iv)},key,b64ToBytes(payload.data));
  return JSON.parse(decoder.decode(plain));
}
