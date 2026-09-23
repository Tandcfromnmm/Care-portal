// Safe Route Phase 1.5
// Communication requires Supabase. See config.js and supabase_setup.sql.

const CFG = window.SAFE_ROUTE_CONFIG || {};
const hasSupabaseConfig = CFG.SUPABASE_URL && !CFG.SUPABASE_URL.includes("YOUR-PROJECT") &&
  CFG.SUPABASE_ANON_KEY && !CFG.SUPABASE_ANON_KEY.includes("YOUR_SUPABASE");

const sb = hasSupabaseConfig ? window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY) : null;

const map = L.map("map").setView([17.3850,78.4867],12);
L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",{maxZoom:19,attribution:'&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'}).addTo(map);

let currentPosition=null,userMarker=null,userCircle=null,routeLayer=null,nearbyLayer=L.layerGroup().addTo(map);
let currentUser=null, chatUser=null, chatChannel=null, callChannel=null;
let mediaRecorder=null, audioChunks=[], voiceBlob=null, recordTimer=null, recordSeconds=0;
let peer=null, localStream=null, activeCall=false;

const $=id=>document.getElementById(id);
function esc(v){return String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]))}
function setStatus(t){$("mapStatus").textContent=t}
function km(a,b){const R=6371,dLat=(b.lat-a.lat)*Math.PI/180,dLon=(b.lon-a.lon)*Math.PI/180,x=Math.sin(dLat/2)**2+Math.cos(a.lat*Math.PI/180)*Math.cos(b.lat*Math.PI/180)*Math.sin(dLon/2)**2;return 2*R*Math.asin(Math.sqrt(x))}
function dist(v){return v<1?`${Math.round(v*1000)} m`:`${v.toFixed(1)} km`}
function duration(s){let m=Math.max(1,Math.round(s/60));return m<60?`${m} min`:`${Math.floor(m/60)} hr${m%60?" "+m%60+" min":""}`}

function locate(){
 if(!navigator.geolocation)return setStatus("Geolocation is not supported.");
 setStatus("Requesting your location…");
 navigator.geolocation.getCurrentPosition(p=>{
  currentPosition={lat:p.coords.latitude,lon:p.coords.longitude};
  if(userMarker)userMarker.setLatLng([currentPosition.lat,currentPosition.lon]);else userMarker=L.marker([currentPosition.lat,currentPosition.lon]).addTo(map).bindPopup("<b>You are here</b>");
  if(userCircle)userCircle.setLatLng([currentPosition.lat,currentPosition.lon]).setRadius(p.coords.accuracy||30);else userCircle=L.circle([currentPosition.lat,currentPosition.lon],{radius:p.coords.accuracy||30,color:"#4d9cff",fillOpacity:.08}).addTo(map);
  map.setView([currentPosition.lat,currentPosition.lon],15);setStatus(`Location found • ±${Math.round(p.coords.accuracy||0)} m`);
 },e=>setStatus(e.code===1?"Location permission denied.":"Could not get your location."),{enableHighAccuracy:true,timeout:15000,maximumAge:30000});
}

function openAuth(){ $("authModal").classList.remove("hidden") }
function closeAuth(){ $("authModal").classList.add("hidden") }
$("authBtn").onclick=()=>currentUser?signOut():openAuth();
$("closeAuth").onclick=closeAuth;

async function signIn(){
 if(!sb)return authMessage("Add your Supabase URL/key in config.js first.");
 const email=$("emailInput").value.trim(),password=$("passwordInput").value;
 if(!email||!password)return authMessage("Enter email and password.");
 authMessage("Signing in…");
 const {data,error}=await sb.auth.signInWithPassword({email,password});
 if(error)return authMessage(error.message);
 closeAuth();await afterAuth(data.user);
}
async function signUp(){
 if(!sb)return authMessage("Add your Supabase URL/key in config.js first.");
 const email=$("emailInput").value.trim(),password=$("passwordInput").value;
 if(password.length<6)return authMessage("Password must be at least 6 characters.");
 authMessage("Creating account…");
 const {data,error}=await sb.auth.signUp({email,password});
 if(error)return authMessage(error.message);
 if(data.user){await ensureProfile(data.user);authMessage("Account created. Check email if confirmation is enabled.");}
}
function authMessage(t){$("authStatus").textContent=t}
async function signOut(){if(sb)await sb.auth.signOut();currentUser=null;chatUser=null;$("userLabel").textContent="Not signed in";$("authBtn").textContent="Sign in";$("onlineBadge").textContent="Offline";$("onlineBadge").className="badge";clearChat()}
async function ensureProfile(u){if(!sb)return;await sb.from("profiles").upsert({id:u.id,email:u.email},{onConflict:"id"})}
async function afterAuth(u){
 currentUser=u;await ensureProfile(u);$("userLabel").textContent=u.email||u.id;$("authBtn").textContent="Sign out";$("onlineBadge").textContent="Online";$("onlineBadge").className="badge ready";
 subscribeSignals();
}
async function initAuth(){
 if(!sb){$("onlineBadge").textContent="Setup needed";$("onlineBadge").className="badge warning";return}
 const {data}=await sb.auth.getSession();if(data.session)await afterAuth(data.session.user);
 sb.auth.onAuthStateChange(async(_event,session)=>{if(session&&!currentUser)await afterAuth(session.user);});
}
function getRecipient(){return $("recipientInput").value.trim()}
async function findUser(identifier){
 if(!sb||!currentUser)return null;
 let q=identifier.includes("@")?sb.from("profiles").select("id,email").eq("email",identifier).limit(1):sb.from("profiles").select("id,email").eq("id",identifier).limit(1);
 const {data,error}=await q;if(error||!data?.length)return null;return data[0];
}
async function openChat(){
 if(!currentUser)return openAuth();
 const ident=getRecipient();if(!ident)return;
 const u=await findUser(ident);if(!u)return $("chatWith").textContent="User not found. They must create an account first.";
 if(u.id===currentUser.id)return $("chatWith").textContent="Choose another user.";
 chatUser=u;$("chatWith").textContent=`Chatting with ${u.email||u.id}`;await loadMessages();subscribeMessages();
}
function clearChat(){$("messages").innerHTML='<div class="muted">Sign in and open a conversation.</div>'}
async function loadMessages(){
 if(!sb||!chatUser)return;
 const {data,error}=await sb.from("messages").select("*").or(`and(sender_id.eq.${currentUser.id},recipient_id.eq.${chatUser.id}),and(sender_id.eq.${chatUser.id},recipient_id.eq.${currentUser.id})`).order("created_at",{ascending:true}).limit(100);
 if(error)return $("messages").innerHTML=`<div class="muted">${esc(error.message)}</div>`;
 $("messages").innerHTML="";data.forEach(renderMessage);
 const box=$("messages");box.scrollTop=box.scrollHeight;
}
function renderMessage(m){
 const div=document.createElement("div");div.className="bubble "+(m.sender_id===currentUser.id?"me":"them");
 if(m.message_type==="voice"){
   const audio=document.createElement("audio");audio.controls=true;
   if(m.media_path&&sb){sb.storage.from("voice-messages").createSignedUrl(m.media_path,3600).then(({data})=>{if(data?.signedUrl)audio.src=data.signedUrl});}
   div.appendChild(audio);
 }else if(m.message_type==="location"){
   const a=document.createElement("a");a.href=`https://www.openstreetmap.org/?mlat=${m.latitude}&mlon=${m.longitude}#map=17/${m.latitude}/${m.longitude}`;a.target="_blank";a.rel="noopener";a.textContent="📍 Shared location";div.appendChild(a);
 }else div.appendChild(document.createTextNode(m.content||""));
 const t=document.createElement("span");t.className="time";t.textContent=new Date(m.created_at).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"});div.appendChild(t);
 $("messages").appendChild(div);
}
function subscribeMessages(){
 if(chatChannel)sb.removeChannel(chatChannel);
 chatChannel=sb.channel("messages-live").on("postgres_changes",{event:"INSERT",schema:"public",table:"messages"},payload=>{
   const m=payload.new;if(!chatUser)return;
   if((m.sender_id===currentUser.id&&m.recipient_id===chatUser.id)||(m.sender_id===chatUser.id&&m.recipient_id===currentUser.id)){renderMessage(m);$("messages").scrollTop=$("messages").scrollHeight}
 }).subscribe();
}
async function sendText(){
 if(!currentUser)return openAuth();if(!chatUser)return $("chatWith").textContent="Open a chat first.";
 const content=$("messageInput").value.trim();if(!content)return;
 const {error}=await sb.from("messages").insert({sender_id:currentUser.id,recipient_id:chatUser.id,message_type:"text",content});
 if(!error)$("messageInput").value="";else alert(error.message);
}
$("sendBtn").onclick=sendText;$("messageInput").addEventListener("keydown",e=>{if(e.key==="Enter")sendText()});
$("openChatBtn").onclick=openChat;$("signInBtn").onclick=signIn;$("signUpBtn").onclick=signUp;

async function startRecording(){
 if(!currentUser||!chatUser)return alert("Sign in and open a chat first.");
 if(!navigator.mediaDevices?.getUserMedia)return alert("Audio recording is not supported.");
 try{
  const stream=await navigator.mediaDevices.getUserMedia({audio:true});audioChunks=[];
  mediaRecorder=new MediaRecorder(stream);recordSeconds=0;$("recordTime").textContent="00:00";
  mediaRecorder.ondataavailable=e=>{if(e.data.size)audioChunks.push(e.data)};
  mediaRecorder.onstop=()=>{stream.getTracks().forEach(t=>t.stop());voiceBlob=new Blob(audioChunks,{type:mediaRecorder.mimeType||"audio/webm"});$("voicePreview").src=URL.createObjectURL(voiceBlob);$("voicePreview").classList.remove("hidden");$("sendVoiceBtn").classList.remove("hidden")};
  mediaRecorder.start();$("recordBtn").textContent="⏹ Stop recording";
  recordTimer=setInterval(()=>{recordSeconds++;$("recordTime").textContent=`${String(Math.floor(recordSeconds/60)).padStart(2,"0")}:${String(recordSeconds%60).padStart(2,"0")}`},1000);
 }catch(e){alert(e.message)}
}
function stopRecording(){if(mediaRecorder?.state==="recording"){clearInterval(recordTimer);mediaRecorder.stop();$("recordBtn").textContent="🎙️ Start recording"}}
$("recordBtn").onclick=()=>mediaRecorder?.state==="recording"?stopRecording():startRecording();
$("sendVoiceBtn").onclick=async()=>{
 if(!voiceBlob||!chatUser)return;
 const path=`${currentUser.id}/${crypto.randomUUID()}.webm`;
 const {error:upErr}=await sb.storage.from("voice-messages").upload(path,voiceBlob,{contentType:voiceBlob.type});
 if(upErr)return alert(upErr.message);
 const {error}=await sb.from("messages").insert({sender_id:currentUser.id,recipient_id:chatUser.id,message_type:"voice",media_path:path});
 if(error)return alert(error.message);
 voiceBlob=null;$("voicePreview").classList.add("hidden");$("sendVoiceBtn").classList.add("hidden");
};

async function shareLocation(){
 if(!currentUser)return openAuth();if(!chatUser)return alert("Open a chat first.");if(!currentPosition)locate();
 if(!currentPosition)return;
 const {error}=await sb.from("messages").insert({sender_id:currentUser.id,recipient_id:chatUser.id,message_type:"location",latitude:currentPosition.lat,longitude:currentPosition.lon});
 $("shareStatus").textContent=error?error.message:"Location shared.";
}
$("shareLocationBtn").onclick=shareLocation;

function subscribeSignals(){
 if(callChannel)sb.removeChannel(callChannel);
 callChannel=sb.channel("call-signals").on("postgres_changes",{event:"INSERT",schema:"public",table:"call_signals"},async payload=>{
   const s=payload.new;if(!currentUser||s.recipient_id!==currentUser.id)return;
   await handleSignal(s.signal,s.sender_id);
 }).subscribe();
}
async function sendSignal(recipient,signal){await sb.from("call_signals").insert({sender_id:currentUser.id,recipient_id:recipient,signal})}
async function makePeer(isCaller){
 peer=new RTCPeerConnection({iceServers:[{urls:"stun:stun.l.google.com:19302"}]});
 peer.onicecandidate=e=>{if(e.candidate&&chatUser)sendSignal(chatUser.id,{type:"ice",candidate:e.candidate.toJSON()})};
 peer.ontrack=e=>{$("remoteAudio").srcObject=e.streams[0]};
 if(isCaller){
  localStream=await navigator.mediaDevices.getUserMedia({audio:true});localStream.getTracks().forEach(t=>peer.addTrack(t,localStream));
  const offer=await peer.createOffer();await peer.setLocalDescription(offer);await sendSignal(chatUser.id,{type:"offer",sdp:offer.sdp});
 }else{
  localStream=await navigator.mediaDevices.getUserMedia({audio:true});localStream.getTracks().forEach(t=>peer.addTrack(t,localStream));
 }
}
async function handleSignal(signal,sender){
 if(!chatUser&&sender)chatUser={id:sender};
 if(signal.type==="offer"){
  if(!peer)await makePeer(false);await peer.setRemoteDescription({type:"offer",sdp:signal.sdp});
  const answer=await peer.createAnswer();await peer.setLocalDescription(answer);await sendSignal(sender,{type:"answer",sdp:answer.sdp});$("callStatus").textContent="Incoming call connected";
 }else if(signal.type==="answer"&&peer)await peer.setRemoteDescription({type:"answer",sdp:signal.sdp});
 else if(signal.type==="ice"&&peer)try{await peer.addIceCandidate(signal.candidate)}catch(e){}
}
$("callBtn").onclick=async()=>{
 if(!currentUser)return openAuth();if(!chatUser)return alert("Open a chat first.");
 try{$("callStatus").textContent="Calling…";activeCall=true;await makePeer(true)}catch(e){$("callStatus").textContent=e.message}
};
$("hangupBtn").onclick=hangup;
function hangup(){if(peer)peer.close();peer=null;if(localStream)localStream.getTracks().forEach(t=>t.stop());localStream=null;activeCall=false;$("callStatus").textContent="No active call";$("remoteAudio").srcObject=null}

document.querySelectorAll(".tab").forEach(b=>b.onclick=()=>{document.querySelectorAll(".tab").forEach(x=>x.classList.remove("active"));b.classList.add("active");document.querySelectorAll(".tab-panel").forEach(x=>x.classList.add("hidden"));$(b.dataset.tab+"Tab").classList.remove("hidden")});
$("authModal").addEventListener("click",e=>{if(e.target.id==="authModal")closeAuth()});

// Route + nearby
async function geocode(q){const r=await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=${encodeURIComponent(q)}`,{headers:{"Accept-Language":"en"}});const d=await r.json();if(!d.length)throw Error("Destination not found");return{lat:+d[0].lat,lon:+d[0].lon,name:d[0].display_name}}
async function planRoute(){
 if(!currentPosition){locate();return}const q=$("destinationInput").value.trim();if(!q)return;
 $("routeBadge").textContent="Planning…";$("routeBadge").className="badge warning";
 try{const d=await geocode(q),u=currentPosition,r=await fetch(`https://router.project-osrm.org/route/v1/driving/${u.lon},${u.lat};${d.lon},${d.lat}?overview=full&geometries=geojson`),j=await r.json(),rt=j.routes[0];if(routeLayer)map.removeLayer(routeLayer);routeLayer=L.geoJSON(rt.geometry,{style:{color:"#4d9cff",weight:6}}).addTo(map);map.fitBounds(routeLayer.getBounds(),{padding:[25,25]});$("routeInfo").innerHTML=`<div class="stats"><div class="stat"><strong>${(rt.distance/1000).toFixed(1)} km</strong><span>distance</span></div><div class="stat"><strong>${duration(rt.duration)}</strong><span>drive time</span></div></div><div class="advisory"><b>Advisory:</b> Route calculated. Check nearby fuel, ATM, transit and emergency services before travelling.</div>`;$("routeBadge").textContent="Ready";$("routeBadge").className="badge ready"}catch(e){$("routeInfo").innerHTML=`<div class="muted">${esc(e.message)}</div>`}
}
$("routeBtn").onclick=planRoute;$("destinationInput").addEventListener("keydown",e=>{if(e.key==="Enter")planRoute()});

const cats={metro:{e:"🚇",l:"Metro",q:`["railway"="station"]["station"="subway"]`},bus:{e:"🚌",l:"Bus stop",q:`["highway"="bus_stop"]`},fuel:{e:"⛽",l:"Fuel",q:`["amenity"="fuel"]`},atm:{e:"🏧",l:"ATM",q:`["amenity"="atm"]`}};
async function nearby(c){
 if(!currentPosition){locate();return}const x=cats[c];$("nearbyResults").innerHTML='<div class="muted">Searching…</div>';
 const q=`[out:json][timeout:15];(node(around:3000,${currentPosition.lat},${currentPosition.lon})${x.q};way(around:3000,${currentPosition.lat},${currentPosition.lon})${x.q};);out center tags;`;
 try{const r=await fetch("https://overpass-api.de/api/interpreter",{method:"POST",body:q}),j=await r.json();nearbyLayer.clearLayers();const a=j.elements.map(z=>{const lat=z.lat??z.center?.lat,lon=z.lon??z.center?.lon,t=z.tags||{};return{lat,lon,n:t.name||t.brand||x.l,d:km(currentPosition,{lat,lon})}}).filter(z=>Number.isFinite(z.lat)&&Number.isFinite(z.lon)).sort((a,b)=>a.d-b.d).slice(0,12);
 $("nearbyResults").innerHTML=a.length?a.map((z,i)=>`<div class="place"><div><div class="place-name">${x.e} ${esc(z.n)}</div><div class="place-meta">${dist(z.d)}</div></div><button data-i="${i}">Show</button></div>`).join(""):`<div class="muted">No results within about 3 km.</div>`;
 a.forEach((z,i)=>nearbyLayer.addLayer(L.marker([z.lat,z.lon]).bindPopup(`<b>${x.e} ${esc(z.n)}</b><br>${dist(z.d)} away`).bindTooltip(x.l)));
 $("nearbyResults").querySelectorAll("button").forEach(b=>b.onclick=()=>{const z=a[+b.dataset.i];map.setView([z.lat,z.lon],17)})
 }catch(e){$("nearbyResults").innerHTML=`<div class="muted">${esc(e.message)}</div>`}
}
document.querySelectorAll(".nearby-btn").forEach(b=>b.onclick=()=>{document.querySelectorAll(".nearby-btn").forEach(x=>x.classList.remove("active"));b.classList.add("active");nearby(b.dataset.category)});
$("refreshNearbyBtn").onclick=()=>{const b=document.querySelector(".nearby-btn.active");if(b)nearby(b.dataset.category)};
locate();initAuth();
