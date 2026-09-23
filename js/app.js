
const C = window.SAFE_ROUTE_CONFIG || {};

const configured =
  C.SUPABASE_URL &&
  C.SUPABASE_ANON_KEY &&
  !C.SUPABASE_URL.includes("YOUR_") &&
  !C.SUPABASE_ANON_KEY.includes("YOUR_");

const sb = configured
  ? window.supabase.createClient(C.SUPABASE_URL, C.SUPABASE_ANON_KEY)
  : null;

const $ = id => document.getElementById(id);

const esc = s =>
  String(s ?? "").replace(/[&<>"']/g, c => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  }[c]));

let pos = null;
let userMarker = null;
let userCircle = null;
let routeLayer = null;

let nearbyLayer;

let me = null;
let friend = null;

let msgChannel = null;
let signalChannel = null;

let peer = null;
let stream = null;

let rec = null;
let chunks = [];
let voice = null;
let timer = null;
let seconds = 0;


/* =========================
   MAP
========================= */

const map = L.map("map").setView([17.385, 78.4867], 12);

L.tileLayer(
  "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
  {
    maxZoom: 19,
    attribution: "&copy; OpenStreetMap"
  }
).addTo(map);

nearbyLayer = L.layerGroup().addTo(map);


/* =========================
   GENERAL UI
========================= */

function status(t) {
  $("mapStatus").textContent = t;
}

function badge(id, t, c) {
  $(id).textContent = t;
  $(id).className = "badge " + (c || "");
}


/* =========================
   DISTANCE
========================= */

function distance(a, b) {

  const R = 6371;

  const d1 =
    (b.lat - a.lat) *
    Math.PI / 180;

  const d2 =
    (b.lon - a.lon) *
    Math.PI / 180;

  const x =
    Math.sin(d1 / 2) ** 2 +
    Math.cos(a.lat * Math.PI / 180) *
    Math.cos(b.lat * Math.PI / 180) *
    Math.sin(d2 / 2) ** 2;

  return 2 * R * Math.asin(Math.sqrt(x));
}


/* =========================
   GPS
========================= */

function locate() {

  if (!navigator.geolocation) {
    return status("Geolocation is not supported.");
  }

  status("Requesting location…");

  navigator.geolocation.getCurrentPosition(
    p => {

      pos = {
        lat: p.coords.latitude,
        lon: p.coords.longitude
      };

      if (userMarker) {

        userMarker.setLatLng([
          pos.lat,
          pos.lon
        ]);

      } else {

        userMarker =
          L.marker([
            pos.lat,
            pos.lon
          ])
            .addTo(map)
            .bindPopup("You are here");

      }

      if (userCircle) {

        userCircle
          .setLatLng([
            pos.lat,
            pos.lon
          ])
          .setRadius(
            p.coords.accuracy || 30
          );

      } else {

        userCircle =
          L.circle(
            [
              pos.lat,
              pos.lon
            ],
            {
              radius: p.coords.accuracy || 30,
              color: "#55a5ff",
              fillOpacity: 0.08
            }
          ).addTo(map);

      }

      map.setView(
        [
          pos.lat,
          pos.lon
        ],
        15
      );

      status(
        "Location found • ±" +
        Math.round(p.coords.accuracy || 0) +
        " m"
      );

    },

    e => {

      if (e.code === 1) {
        status("Location permission denied.");
      } else {
        status("Could not get your location.");
      }

    },

    {
      enableHighAccuracy: true,
      timeout: 15000,
      maximumAge: 30000
    }
  );
}

$("locateBtn").onclick = locate;


/* =========================
   AUTH
========================= */

function authModal() {
  $("authModal").classList.remove("hidden");
}

$("closeModal").onclick = () => {
  $("authModal").classList.add("hidden");
};


$("signIn").onclick = async () => {

  if (!sb) {

    $("authStatus").textContent =
      "First configure js/config.js with your Supabase URL and public key.";

    return;
  }

  const email =
    $("authEmail").value.trim();

  const password =
    $("authPassword").value;

  const {
    data,
    error
  } =
    await sb.auth.signInWithPassword({
      email,
      password
    });

  if (error) {

    $("authStatus").textContent =
      error.message;

    return;
  }

  $("authModal").classList.add("hidden");

  await loggedIn(data.user);
};


$("signUp").onclick = async () => {

  if (!sb) {

    $("authStatus").textContent =
      "First configure js/config.js.";

    return;
  }

  const email =
    $("authEmail").value.trim();

  const password =
    $("authPassword").value;

  const {
    data,
    error
  } =
    await sb.auth.signUp({
      email,
      password
    });

  if (error) {

    $("authStatus").textContent =
      error.message;

    return;
  }

  $("authStatus").textContent =
    data.session
      ? "Account created."
      : "Account created. Check your email if confirmation is enabled.";

  if (data.user) {
    await ensureProfile(data.user);
  }
};


async function ensureProfile(u) {

  if (!sb) return;

  await sb
    .from("profiles")
    .upsert(
      {
        id: u.id,
        email: u.email
      },
      {
        onConflict: "id"
      }
    );
}


async function loggedIn(u) {

  me = u;

  await ensureProfile(u);

  badge(
    "connection",
    "Online",
    "ok"
  );

  $("authModal").classList.add("hidden");

  $("locateBtn").textContent =
    "📍 Locate me";

  subscribeSignals();
}


async function init() {

  if (!configured) {

    badge(
      "connection",
      "Setup needed",
      "warn"
    );

    return;
  }

  const {
    data
  } =
    await sb.auth.getSession();

  if (data.session) {
    await loggedIn(data.session.user);
  }

  sb.auth.onAuthStateChange(
    async (e, s) => {

      if (s && !me) {
        await loggedIn(s.user);
      }

    }
  );
}


$("connection").onclick = () => {

  if (!me) {
    authModal();
  }

};


/* =========================
   COMMUNICATION TABS
========================= */

document
  .querySelectorAll(".tab")
  .forEach(b => {

    b.onclick = () => {

      document
        .querySelectorAll(".tab")
        .forEach(x =>
          x.classList.remove("active")
        );

      b.classList.add("active");

      document
        .querySelectorAll(".panel")
        .forEach(x =>
          x.classList.add("hidden")
        );

      $(
        b.dataset.tab + "Panel"
      ).classList.remove("hidden");

    };

  });


/* =========================
   FIND FRIEND
========================= */

async function findFriend() {

  if (!me) {
    return authModal();
  }

  const email =
    $("emailTo").value.trim();

  if (!email) return;

  const {
    data
  } =
    await sb
      .from("profiles")
      .select("id,email")
      .eq("email", email)
      .limit(1);

  if (!data?.length) {

    $("chatName").textContent =
      "User not found.";

    return;
  }

  friend = data[0];

  $("chatName").textContent =
    "Chatting with " +
    (friend.email || friend.id);

  await loadMessages();

  subscribeMessages();
}


$("openChat").onclick =
  findFriend;


/* =========================
   LOAD MESSAGES
========================= */

async function loadMessages() {

  if (!friend) return;

  const a = me.id;
  const b = friend.id;

  const {
    data,
    error
  } =
    await sb
      .from("messages")
      .select("*")
      .or(
        `and(sender_id.eq.${a},recipient_id.eq.${b}),and(sender_id.eq.${b},recipient_id.eq.${a})`
      )
      .order("created_at");

  if (error) {

    $("messages").innerHTML =
      '<div class="muted">' +
      esc(error.message) +
      "</div>";

    return;
  }

  $("messages").innerHTML = "";

  data.forEach(draw);

  $("messages").scrollTop =
    $("messages").scrollHeight;
}


/* =========================
   DRAW MESSAGE
========================= */

function draw(m) {

  const d =
    document.createElement("div");

  d.className =
    "bubble " +
    (
      m.sender_id === me.id
        ? "me"
        : "them"
    );


  if (m.message_type === "location") {

    const a =
      document.createElement("a");

    a.href =
      `https://www.openstreetmap.org/?mlat=${m.latitude}&mlon=${m.longitude}#map=17/${m.latitude}/${m.longitude}`;

    a.target = "_blank";

    a.textContent =
      "📍 Shared location";

    d.appendChild(a);

  }

  else if (m.message_type === "voice") {

    const au =
      document.createElement("audio");

    au.controls = true;

    d.appendChild(au);

    if (m.media_path) {

      sb
        .storage
        .from("voice-messages")
        .createSignedUrl(
          m.media_path,
          3600
        )
        .then(x => {

          if (x.data?.signedUrl) {
            au.src =
              x.data.signedUrl;
          }

        });

    }

  }

  else {

    d.appendChild(
      document.createTextNode(
        m.content || ""
      )
    );

  }

  $("messages").appendChild(d);
}


/* =========================
   REALTIME MESSAGES
========================= */

function subscribeMessages() {

  if (msgChannel) {
    sb.removeChannel(msgChannel);
  }

  msgChannel =
    sb
      .channel(
        "messages-" + me.id
      )
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages"
        },
        p => {

          const m = p.new;

          if (
            friend &&
            (
              (
                m.sender_id === me.id &&
                m.recipient_id === friend.id
              ) ||
              (
                m.sender_id === friend.id &&
                m.recipient_id === me.id
              )
            )
          ) {

            draw(m);

            $("messages").scrollTop =
              $("messages").scrollHeight;
          }

        }
      )
      .subscribe();
}


/* =========================
   SEND TEXT
========================= */

async function send() {

  if (!me) {
    return authModal();
  }

  if (!friend) {
    return alert(
      "Open a chat first."
    );
  }

  const text =
    $("message").value.trim();

  if (!text) return;

  const {
    error
  } =
    await sb
      .from("messages")
      .insert({
        sender_id: me.id,
        recipient_id: friend.id,
        message_type: "text",
        content: text
      });

  if (error) {

    alert(error.message);

  } else {

    $("message").value = "";

  }
}


$("send").onclick = send;

$("message").addEventListener(
  "keydown",
  e => {

    if (e.key === "Enter") {
      send();
    }

  }
);


/* =========================
   VOICE RECORDING
========================= */

async function startRec() {

  if (!me || !friend) {

    return alert(
      "Sign in and open a chat first."
    );
  }

  try {

    const s =
      await navigator
        .mediaDevices
        .getUserMedia({
          audio: true
        });

    chunks = [];

    rec =
      new MediaRecorder(s);

    seconds = 0;

    $("timer").textContent =
      "00:00";


    rec.ondataavailable =
      e => {

        if (e.data.size) {
          chunks.push(e.data);
        }

      };


    rec.onstop = () => {

      s
        .getTracks()
        .forEach(t => t.stop());

      voice =
        new Blob(
          chunks,
          {
            type:
              rec.mimeType ||
              "audio/webm"
          }
        );

      $("preview").src =
        URL.createObjectURL(
          voice
        );

      $("preview")
        .classList
        .remove("hidden");

      $("sendVoice")
        .classList
        .remove("hidden");

    };


    rec.start();

    $("record").textContent =
      "⏹ Stop";


    timer =
      setInterval(() => {

        seconds++;

        $("timer").textContent =
          String(
            Math.floor(seconds / 60)
          ).padStart(2, "0") +
          ":" +
          String(
            seconds % 60
          ).padStart(2, "0");

      }, 1000);

  }

  catch (e) {

    alert(e.message);

  }
}


$("record").onclick = () => {

  if (
    rec &&
    rec.state === "recording"
  ) {

    clearInterval(timer);

    rec.stop();

    $("record").textContent =
      "🎙️ Start recording";

  }

  else {

    startRec();

  }

};


$("sendVoice").onclick =
  async () => {

    if (!voice || !friend) return;

    const path =
      me.id +
      "/" +
      crypto.randomUUID() +
      ".webm";


    const u =
      await sb
        .storage
        .from("voice-messages")
        .upload(
          path,
          voice,
          {
            contentType:
              voice.type
          }
        );


    if (u.error) {
      return alert(
        u.error.message
      );
    }


    const m =
      await sb
        .from("messages")
        .insert({
          sender_id: me.id,
          recipient_id: friend.id,
          message_type: "voice",
          media_path: path
        });


    if (m.error) {

      alert(m.error.message);

    }

    else {

      $("preview")
        .classList
        .add("hidden");

      $("sendVoice")
        .classList
        .add("hidden");

      voice = null;

    }

  };


/* =========================
   SHARE LOCATION
========================= */

$("shareLocation").onclick =
  async () => {

    if (!me) {
      return authModal();
    }

    if (!friend) {
      return alert(
        "Open a chat first."
      );
    }

    if (!pos) {

      locate();

      return;
    }


    const {
      error
    } =
      await sb
        .from("messages")
        .insert({
          sender_id: me.id,
          recipient_id: friend.id,
          message_type: "location",
          latitude: pos.lat,
          longitude: pos.lon
        });


    $("shareStatus").textContent =
      error
        ? error.message
        : "Location shared.";

  };


/* =========================
   WEBRTC VOICE CALL
========================= */

async function sendSignal(
  to,
  signal
) {

  await sb
    .from("call_signals")
    .insert({
      sender_id: me.id,
      recipient_id: to,
      signal
    });

}


function subscribeSignals() {

  if (signalChannel) {
    sb.removeChannel(
      signalChannel
    );
  }


  signalChannel =
    sb
      .channel(
        "calls-" + me.id
      )
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "call_signals"
        },
        async p => {

          if (
            p.new.recipient_id ===
            me.id
          ) {

            await signal(
              p.new.signal,
              p.new.sender_id
            );

          }

        }
      )
      .subscribe();

}


async function newPeer(caller) {

  peer =
    new RTCPeerConnection({
      iceServers: [
        {
          urls:
            "stun:stun.l.google.com:19302"
        }
      ]
    });


  peer.onicecandidate =
    e => {

      if (e.candidate) {

        sendSignal(
          friend.id,
          {
            type: "ice",
            candidate:
              e.candidate.toJSON()
          }
        );

      }

    };


  peer.ontrack =
    e => {

      $("remoteAudio").srcObject =
        e.streams[0];

    };


  stream =
    await navigator
      .mediaDevices
      .getUserMedia({
        audio: true
      });


  stream
    .getTracks()
    .forEach(
      t =>
        peer.addTrack(
          t,
          stream
        )
    );


  if (caller) {

    const offer =
      await peer.createOffer();

    await peer.setLocalDescription(
      offer
    );

    await sendSignal(
      friend.id,
      {
        type: "offer",
        sdp: offer.sdp
      }
    );

  }

}


async function signal(
  s,
  from
) {

  if (!friend) {
    friend = {
      id: from
    };
  }


  if (s.type === "offer") {

    if (!peer) {
      await newPeer(false);
    }

    await peer.setRemoteDescription({
      type: "offer",
      sdp: s.sdp
    });


    const answer =
      await peer.createAnswer();

    await peer.setLocalDescription(
      answer
    );


    await sendSignal(
      from,
      {
        type: "answer",
        sdp: answer.sdp
      }
    );


    $("callStatus").textContent =
      "Call connected";

  }


  else if (
    s.type === "answer" &&
    peer
  ) {

    await peer.setRemoteDescription({
      type: "answer",
      sdp: s.sdp
    });

  }


  else if (
    s.type === "ice" &&
    peer
  ) {

    try {

      await peer.addIceCandidate(
        s.candidate
      );

    }

    catch (e) {}

  }

}


$("call").onclick =
  async () => {

    if (!me) {
      return authModal();
    }

    if (!friend) {
      return alert(
        "Open a chat first."
      );
    }

    try {

      $("callStatus").textContent =
        "Calling…";

      await newPeer(true);

    }

    catch (e) {

      $("callStatus").textContent =
        e.message;

    }

  };


$("hangup").onclick = () => {

  if (peer) {
    peer.close();
  }

  peer = null;


  if (stream) {

    stream
      .getTracks()
      .forEach(
        t => t.stop()
      );

  }

  stream = null;

  $("callStatus").textContent =
    "No active call";

};


/* =========================
   DESTINATION SEARCH
========================= */

async function geocode(q) {

  const r =
    await fetch(
      "https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=" +
      encodeURIComponent(q)
    );

  const d =
    await r.json();

  if (!d.length) {
    throw Error(
      "Destination not found"
    );
  }

  return {
    lat: +d[0].lat,
    lon: +d[0].lon,
    name: d[0].display_name
  };

}


/* =========================
   ROUTE
========================= */

$("route").onclick =
  async () => {

    if (!pos) {

      locate();

      return;
    }


    const q =
      $("destination").value.trim();

    if (!q) return;


    badge(
      "routeState",
      "Planning…",
      "warn"
    );


    try {

      const d =
        await geocode(q);


      const r =
        await fetch(
          `https://router.project-osrm.org/route/v1/driving/${pos.lon},${pos.lat};${d.lon},${d.lat}?overview=full&geometries=geojson`
        );


      const j =
        await r.json();


      const rt =
        j.routes[0];


      if (routeLayer) {
        map.removeLayer(
          routeLayer
        );
      }


      routeLayer =
        L.geoJSON(
          rt.geometry,
          {
            style: {
              color: "#55a5ff",
              weight: 6
            }
          }
        ).addTo(map);


      map.fitBounds(
        routeLayer.getBounds(),
        {
          padding: [
            25,
            25
          ]
        }
      );


      const kmv =
        rt.distance / 1000;

      const min =
        Math.round(
          rt.duration / 60
        );


      $("routeInfo").innerHTML =

        `<div class="stats">
          <div class="stat">
            <b>${kmv.toFixed(1)} km</b>
            <span>distance</span>
          </div>

          <div class="stat">
            <b>${
              min < 60
                ? min + " min"
                : Math.floor(min / 60) +
                  " hr " +
                  min % 60 +
                  " min"
            }</b>
            <span>estimated drive time</span>
          </div>
        </div>

        <div class="advice">
          <b>Advisory:</b>
          Check nearby fuel, public transport,
          ATM and emergency services before travelling.
        </div>`;


      badge(
        "routeState",
        "Ready",
        "ok"
      );

    }

    catch (e) {

      $("routeInfo").textContent =
        e.message;

      badge(
        "routeState",
        "Error",
        "warn"
      );

    }

  };


$("destination")
  .addEventListener(
    "keydown",
    e => {

      if (e.key === "Enter") {
        $("route").click();
      }

    }
  );


/* =========================
   NEARBY SERVICES
========================= */

const kinds = {

  metro: [
    "🚇",
    "Metro",
    `["railway"="station"]["station"="subway"]`
  ],

  bus: [
    "🚌",
    "Bus",
    `["highway"="bus_stop"]`
  ],

  fuel: [
    "⛽",
    "Fuel",
    `["amenity"="fuel"]`
  ],

  atm: [
    "🏧",
    "ATM",
    `["amenity"="atm"]`
  ]

};


async function nearby(k) {

  if (!pos) {

    locate();

    return;
  }


  const [
    emoji,
    label,
    q
  ] = kinds[k];


  $("nearbyResults").textContent =
    "Searching…";


  const query =
    `[out:json][timeout:15];
    (
      node(around:3000,${pos.lat},${pos.lon})${q};
      way(around:3000,${pos.lat},${pos.lon})${q};
    );
    out center tags;`;


  try {

    const r =
      await fetch(
        "https://overpass-api.de/api/interpreter",
        {
          method: "POST",
          body: query
        }
      );


    const j =
      await r.json();


    nearbyLayer.clearLayers();


    const arr =
      j.elements
        .map(x => {

          const lat =
            x.lat ??
            x.center?.lat;

          const lon =
            x.lon ??
            x.center?.lon;

          const t =
            x.tags || {};


          return {
            lat,
            lon,
            name:
              t.name ||
              t.brand ||
              label,

            d:
              distance(
                pos,
                {
                  lat,
                  lon
                }
              )
          };

        })
        .filter(
          x =>
            Number.isFinite(x.lat) &&
            Number.isFinite(x.lon)
        )
        .sort(
          (a, b) =>
            a.d - b.d
        )
        .slice(0, 12);


    $("nearbyResults").innerHTML =
      arr.length

        ? arr
            .map(
              (x, i) =>
                `<div class="place">
                  <div>
                    <b>
                      ${emoji}
                      ${esc(x.name)}
                    </b>

                    <small>
                      ${
                        x.d < 1
                          ? Math.round(
                              x.d * 1000
                            ) + " m"
                          : x.d.toFixed(1) +
                            " km"
                      }
                    </small>
                  </div>

                  <button
                    data-i="${i}">
                    Show
                  </button>
                </div>`
            )
            .join("")

        : "No results within about 3 km.";


    arr.forEach(
      x => {

        nearbyLayer.addLayer(
          L.marker([
            x.lat,
            x.lon
          ])
            .bindPopup(
              "<b>" +
              esc(x.name) +
              "</b>"
            )
        );

      }
    );


    $("nearbyResults")
      .querySelectorAll("button")
      .forEach(
        b => {

          b.onclick = () => {

            const x =
              arr[
                +b.dataset.i
              ];

            map.setView(
              [
                x.lat,
                x.lon
              ],
              17
            );

          };

        }
      );

  }

  catch (e) {

    $("nearbyResults").textContent =
      "Nearby search failed. Try again.";

  }

}


document
  .querySelectorAll(
    ".nearby button"
  )
  .forEach(
    b => {

      b.onclick = () => {

        document
          .querySelectorAll(
            ".nearby button"
          )
          .forEach(
            x =>
              x.classList
                .remove("active")
          );


        b.classList.add(
          "active"
        );


        nearby(
          b.dataset.kind
        );

      };

    }
  );


$("refresh").onclick = () => {

  const b =
    document.querySelector(
      ".nearby button.active"
    );

  if (b) {
    nearby(
      b.dataset.kind
    );
  }

};


/* =========================
   START
========================= */

init();
locate();
