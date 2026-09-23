const CONFIG =
  window.SAFE_ROUTE_CONFIG || {};

const SUPABASE_READY =
  CONFIG.SUPABASE_URL &&
  CONFIG.SUPABASE_ANON_KEY &&
  !CONFIG.SUPABASE_URL.includes("YOUR_") &&
  !CONFIG.SUPABASE_ANON_KEY.includes("YOUR_");


const supabaseClient =
  SUPABASE_READY
    ? window.supabase.createClient(
        CONFIG.SUPABASE_URL,
        CONFIG.SUPABASE_ANON_KEY
      )
    : null;


/* =========================
   TEMPORARY SAFE ROUTE ID
========================= */

function generateSafeId() {

  const chars =
    "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

  let result = "SR-";

  for (let i = 0; i < 5; i++) {

    result +=
      chars[
        Math.floor(
          Math.random() * chars.length
        )
      ];

  }

  return result;
}


let mySafeId =
  localStorage.getItem(
    "safe_route_id"
  );


if (!mySafeId) {

  mySafeId =
    generateSafeId();

  localStorage.setItem(
    "safe_route_id",
    mySafeId
  );

}


document.getElementById(
  "mySafeId"
).textContent =
  mySafeId;


/* =========================
   USER STATE
========================= */

let myUserId =
  localStorage.getItem(
    "safe_route_user_id"
  );


if (!myUserId) {

  myUserId =
    crypto.randomUUID();

  localStorage.setItem(
    "safe_route_user_id",
    myUserId
  );

}


let friend = null;

let myPosition = null;

let userMarker = null;

let userCircle = null;

let routeLayer = null;

let nearbyLayer = null;

let messageChannel = null;

let callChannel = null;

let peer = null;

let localStream = null;

let recorder = null;

let recordedChunks = [];

let voiceBlob = null;


/* =========================
   HELPERS
========================= */

const $ =
  id =>
    document.getElementById(id);


function status(text) {

  $("mapStatus")
    .textContent = text;

}


function setConnection(
  text,
  type = ""
) {

  $("connection")
    .textContent = text;

  $("connection")
    .className =
      "badge " + type;

}


/* =========================
   MAP
========================= */

const map =
  L.map("map")
   .setView(
      [17.385, 78.4867],
      12
    );


L.tileLayer(
  "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
  {
    maxZoom: 19,

    attribution:
      "&copy; OpenStreetMap"
  }
).addTo(map);


nearbyLayer =
  L.layerGroup()
   .addTo(map);


/* =========================
   GPS
========================= */

function locate() {

  if (!navigator.geolocation) {

    status(
      "GPS is not supported."
    );

    return;
  }


  status(
    "Requesting location..."
  );


  navigator.geolocation
    .getCurrentPosition(

      position => {

        myPosition = {

          lat:
            position.coords.latitude,

          lon:
            position.coords.longitude

        };


        if (userMarker) {

          userMarker.setLatLng([
            myPosition.lat,
            myPosition.lon
          ]);

        }

        else {

          userMarker =
            L.marker([
              myPosition.lat,
              myPosition.lon
            ])
            .addTo(map)
            .bindPopup(
              "You are here"
            );

        }


        if (userCircle) {

          userCircle
            .setLatLng([
              myPosition.lat,
              myPosition.lon
            ]);

        }

        else {

          userCircle =
            L.circle(
              [
                myPosition.lat,
                myPosition.lon
              ],
              {
                radius:
                  position.coords.accuracy ||
                  30,

                color:
                  "#55a5ff",

                fillOpacity:
                  0.08
              }
            )
            .addTo(map);

        }


        map.setView(
          [
            myPosition.lat,
            myPosition.lon
          ],
          15
        );


        status(
          "Location found"
        );

      },

      error => {

        status(
          "Location permission denied or unavailable."
        );

      },

      {
        enableHighAccuracy:
          true,

        timeout:
          15000,

        maximumAge:
          30000
      }

    );

}


$("locateBtn")
  .onclick =
  locate;


/* =========================
   COPY SAFE ID
========================= */

$("copyId")
  .onclick =
  async () => {

    try {

      await navigator
        .clipboard
        .writeText(
          mySafeId
        );


      $("copyId")
        .textContent =
        "✓ ID Copied";


      setTimeout(
        () => {

          $("copyId")
            .textContent =
            "📋 Copy my ID";

        },
        1500
      );

    }

    catch {

      alert(
        "Your Safe Route ID: " +
        mySafeId
      );

    }

  };


/* =========================
   SUPABASE ANONYMOUS SESSION
========================= */

async function startAnonymousSession() {

  if (!supabaseClient) {

    setConnection(
      "Backend needed",
      "warn"
    );

    $("connectStatus").textContent =
      "Supabase client was not created.";

    return null;
  }

  try {

    const {
      data,
      error
    } =
      await supabaseClient.auth
        .signInAnonymously();

    if (error) {

      console.error(
        "SUPABASE ERROR:",
        error
      );

      setConnection(
        "Backend error",
        "warn"
      );

      $("connectStatus").textContent =
        "Supabase: " +
        error.message;

      return null;
    }

    setConnection(
      "Online",
      "ok"
    );

    $("connectStatus").textContent =
      "Supabase connected.";

    return data.user;

  }

  catch (error) {

    console.error(
      "SUPABASE EXCEPTION:",
      error
    );

    setConnection(
      "Backend error",
      "warn"
    );

    $("connectStatus").textContent =
      "Supabase: " +
      error.message;

    return null;
  }
}


/* =========================
   REGISTER TEMP ID
========================= */

async function registerSafeId() {

  if (!supabaseClient)
    return;


  const user =
    await startAnonymousSession();


  if (!user)
    return;


  myUserId =
    user.id;


  localStorage.setItem(
    "safe_route_user_id",
    myUserId
  );


  await supabaseClient
    .from("safe_users")
    .upsert(
      {
        id:
          myUserId,

        safe_id:
          mySafeId,

        last_seen:
          new Date().toISOString()
      },
      {
        onConflict:
          "safe_id"
      }
    );


  subscribeMessages();

  subscribeCalls();

}


/* =========================
   CONNECT TO USER
========================= */

$("connectBtn")
  .onclick =
  connectToUser;


async function connectToUser() {

  const id =
    $("friendId")
      .value
      .trim()
      .toUpperCase();


  if (!id) {

    $("connectStatus")
      .textContent =
      "Enter a Safe Route ID.";

    return;
  }


  if (id === mySafeId) {

    $("connectStatus")
      .textContent =
      "You cannot connect to your own ID.";

    return;
  }


  if (!supabaseClient) {

    $("connectStatus")
      .textContent =
      "Configure Supabase first.";

    return;
  }


  const {
    data,
    error
  } =
    await supabaseClient
      .from("safe_users")
      .select(
        "id,safe_id"
      )
      .eq(
        "safe_id",
        id
      )
      .maybeSingle();


  if (error) {

    $("connectStatus")
      .textContent =
      error.message;

    return;
  }


  if (!data) {

    $("connectStatus")
      .textContent =
      "User not found or no longer online.";

    return;
  }


  friend = data;


  $("chatName")
    .textContent =
    "Connected to " +
    friend.safe_id;


  $("connectStatus")
    .textContent =
    "✓ Connected";


  await loadMessages();

}


/* =========================
   MESSAGES
========================= */

async function sendMessage() {

  if (!friend) {

    alert(
      "Connect to a Safe Route user first."
    );

    return;
  }


  const message =
    $("message")
      .value
      .trim();


  if (!message)
    return;


  const {
    error
  } =
    await supabaseClient
      .from("safe_messages")
      .insert({

        sender_id:
          myUserId,

        receiver_id:
          friend.id,

        message_type:
          "text",

        content:
          message

      });


  if (error) {

    alert(
      error.message
    );

    return;
  }


  $("message")
    .value = "";

}


$("send")
  .onclick =
  sendMessage;


$("message")
  .addEventListener(
    "keydown",
    event => {

      if (
        event.key ===
        "Enter"
      ) {

        sendMessage();

      }

    }
  );


/* =========================
   LOAD MESSAGES
========================= */

async function loadMessages() {

  if (!friend)
    return;


  const {
    data,
    error
  } =
    await supabaseClient
      .from("safe_messages")
      .select("*")
      .or(
        `and(sender_id.eq.${myUserId},receiver_id.eq.${friend.id}),and(sender_id.eq.${friend.id},receiver_id.eq.${myUserId})`
      )
      .order(
        "created_at",
        {
          ascending:
            true
        }
      );


  if (error) {

    $("messages")
      .innerHTML =
      "<div class='muted'>" +
      error.message +
      "</div>";

    return;
  }


  $("messages")
    .innerHTML = "";


  data.forEach(
    displayMessage
  );


  $("messages")
    .scrollTop =
    $("messages")
      .scrollHeight;

}


/* =========================
   DISPLAY MESSAGE
========================= */

function displayMessage(
  message
) {

  const div =
    document.createElement(
      "div"
    );


  div.className =
    "bubble " +
    (
      message.sender_id ===
      myUserId
        ? "me"
        : "them"
    );


  if (
    message.message_type ===
    "location"
  ) {

    const link =
      document.createElement(
        "a"
      );


    link.href =
      `https://www.openstreetmap.org/?mlat=${message.latitude}&mlon=${message.longitude}`;


    link.target =
      "_blank";


    link.textContent =
      "📍 Shared location";


    div.appendChild(
      link
    );

  }

  else {

    div.textContent =
      message.content ||
      "";

  }


  $("messages")
    .appendChild(
      div
    );

}


/* =========================
   REALTIME MESSAGES
========================= */

function subscribeMessages() {

  if (!supabaseClient)
    return;


  messageChannel =
    supabaseClient
      .channel(
        "safe-messages-" +
        myUserId
      )
      .on(

        "postgres_changes",

        {
          event:
            "INSERT",

          schema:
            "public",

          table:
            "safe_messages"
        },

        payload => {

          const message =
            payload.new;


          if (
            message.receiver_id ===
              myUserId ||

            message.sender_id ===
              myUserId
          ) {

            displayMessage(
              message
            );


            $("messages")
              .scrollTop =
              $("messages")
                .scrollHeight;

          }

        }

      )
      .subscribe();

}


/* =========================
   LOCATION SHARE
========================= */

$("shareLocation")
  .onclick =
  async () => {

    if (!friend) {

      alert(
        "Connect to a user first."
      );

      return;
    }


    if (!myPosition) {

      locate();

      alert(
        "Please allow GPS and try again."
      );

      return;
    }


    const {
      error
    } =
      await supabaseClient
        .from("safe_messages")
        .insert({

          sender_id:
            myUserId,

          receiver_id:
            friend.id,

          message_type:
            "location",

          latitude:
            myPosition.lat,

          longitude:
            myPosition.lon

        });


    $("shareStatus")
      .textContent =
      error
        ? error.message
        : "✓ Location shared.";

  };


/* =========================
   VOICE RECORDING
========================= */

$("record")
  .onclick =
  async () => {

    if (!friend) {

      alert(
        "Connect to a user first."
      );

      return;
    }


    if (
      recorder &&
      recorder.state ===
        "recording"
    ) {

      recorder.stop();

      return;

    }


    try {

      const microphone =
        await navigator
          .mediaDevices
          .getUserMedia({
            audio:
              true
          });


      recordedChunks = [];


      recorder =
        new MediaRecorder(
          microphone
        );


      recorder.ondataavailable =
        event => {

          if (
            event.data.size
          ) {

            recordedChunks
              .push(
                event.data
              );

          }

        };


      recorder.onstop =
        () => {

          microphone
            .getTracks()
            .forEach(
              track =>
                track.stop()
            );


          voiceBlob =
            new Blob(
              recordedChunks,
              {
                type:
                  recorder.mimeType
              }
            );


          $("preview")
            .src =
            URL.createObjectURL(
              voiceBlob
            );


          $("preview")
            .classList
            .remove(
              "hidden"
            );


          $("sendVoice")
            .classList
            .remove(
              "hidden"
            );


          $("record")
            .textContent =
            "🎙️ Start recording";

        };


      recorder.start();


      $("record")
        .textContent =
        "⏹ Stop recording";

    }

    catch (error) {

      alert(
        error.message
      );

    }

  };


/* =========================
   SEND VOICE
========================= */

$("sendVoice")
  .onclick =
  async () => {

    if (
      !voiceBlob ||
      !friend
    )
      return;


    const filename =
      myUserId +
      "/" +
      crypto.randomUUID() +
      ".webm";


    const upload =
      await supabaseClient
        .storage
        .from(
          "voice-messages"
        )
        .upload(
          filename,
          voiceBlob,
          {
            contentType:
              "audio/webm"
          }
        );


    if (upload.error) {

      alert(
        upload.error.message
      );

      return;
    }


    const {
      error
    } =
      await supabaseClient
        .from(
          "safe_messages"
        )
        .insert({

          sender_id:
            myUserId,

          receiver_id:
            friend.id,

          message_type:
            "voice",

          media_path:
            filename

        });


    if (error) {

      alert(
        error.message
      );

      return;
    }


    voiceBlob = null;


    $("preview")
      .classList
      .add(
        "hidden"
      );


    $("sendVoice")
      .classList
      .add(
        "hidden"
      );

  };


/* =========================
   VOICE CALL
========================= */

async function startCall() {

  if (!friend) {

    alert(
      "Connect to a user first."
    );

    return;
  }


  try {

    localStream =
      await navigator
        .mediaDevices
        .getUserMedia({
          audio:
            true
        });


    peer =
      new RTCPeerConnection({

        iceServers: [
          {
            urls:
              "stun:stun.l.google.com:19302"
          }
        ]

      });


    localStream
      .getTracks()
      .forEach(
        track =>
          peer.addTrack(
            track,
            localStream
          )
      );


    peer.ontrack =
      event => {

        $("remoteAudio")
          .srcObject =
          event.streams[0];

      };


    peer.onicecandidate =
      event => {

        if (
          event.candidate
        ) {

          sendCallSignal(
            {
              type:
                "ice",

              candidate:
                event.candidate
            }
          );

        }

      };


    const offer =
      await peer
        .createOffer();


    await peer
      .setLocalDescription(
        offer
      );


    await sendCallSignal(
      {
        type:
          "offer",

        sdp:
          offer.sdp
      }
    );


    $("callStatus")
      .textContent =
      "Calling...";

  }

  catch (error) {

    $("callStatus")
      .textContent =
      error.message;

  }

}


$("call")
  .onclick =
  startCall;


/* =========================
   CALL SIGNAL
========================= */

async function sendCallSignal(
  signal
) {

  if (!friend)
    return;


  await supabaseClient
    .from(
      "safe_call_signals"
    )
    .insert({

      sender_id:
        myUserId,

      receiver_id:
        friend.id,

      signal:
        signal

    });

}


function subscribeCalls() {

  if (!supabaseClient)
    return;


  callChannel =
    supabaseClient
      .channel(
        "safe-calls-" +
        myUserId
      )
      .on(

        "postgres_changes",

        {
          event:
            "INSERT",

          schema:
            "public",

          table:
            "safe_call_signals"
        },

        async payload => {

          const signal =
            payload.new;


          if (
            signal.receiver_id !==
            myUserId
          )
            return;


          await handleCallSignal(
            signal.signal,
            signal.sender_id
          );

        }

      )
      .subscribe();

}


async function handleCallSignal(
  signal,
  senderId
) {

  if (
    signal.type ===
    "offer"
  ) {

    friend = {
      id:
        senderId
    };


    if (!peer) {

      localStream =
        await navigator
          .mediaDevices
          .getUserMedia({
            audio:
              true
          });


      peer =
        new RTCPeerConnection({

          iceServers: [
            {
              urls:
                "stun:stun.l.google.com:19302"
            }
          ]

        });


      localStream
        .getTracks()
        .forEach(
          track =>
            peer.addTrack(
              track,
              localStream
            )
        );


      peer.ontrack =
        event => {

          $("remoteAudio")
            .srcObject =
            event.streams[0];

        };


      peer.onicecandidate =
        event => {

          if (
            event.candidate
          ) {

            sendCallSignal(
              {
                type:
                  "ice",

                candidate:
                  event.candidate
              }
            );

          }

        };

    }


    await peer
      .setRemoteDescription({
        type:
          "offer",

        sdp:
          signal.sdp
      });


    const answer =
      await peer
        .createAnswer();


    await peer
      .setLocalDescription(
        answer
      );


    await supabaseClient
      .from(
        "safe_call_signals"
      )
      .insert({

        sender_id:
          myUserId,

        receiver_id:
          senderId,

        signal: {
          type:
            "answer",

          sdp:
            answer.sdp
        }

      });


    $("callStatus")
      .textContent =
      "Incoming call connected.";

  }


  else if (
    signal.type ===
      "answer" &&
    peer
  ) {

    await peer
      .setRemoteDescription({

        type:
          "answer",

        sdp:
          signal.sdp

      });


    $("callStatus")
      .textContent =
      "Call connected.";

  }


  else if (
    signal.type ===
      "ice" &&
    peer
  ) {

    try {

      await peer
        .addIceCandidate(
          signal.candidate
        );

    }

    catch (error) {

      console.error(
        error
      );

    }

  }

}


/* =========================
   END CALL
========================= */

$("hangup")
  .onclick =
  () => {

    if (peer) {

      peer.close();

      peer = null;

    }


    if (localStream) {

      localStream
        .getTracks()
        .forEach(
          track =>
            track.stop()
        );

      localStream = null;

    }


    $("callStatus")
      .textContent =
      "No active call.";

  };


/* =========================
   COMMUNICATION TABS
========================= */

document
  .querySelectorAll(
    ".tab"
  )
  .forEach(
    button => {

      button.onclick =
        () => {

          document
            .querySelectorAll(
              ".tab"
            )
            .forEach(
              b =>
                b.classList
                  .remove(
                    "active"
                  )
            );


          button
            .classList
            .add(
              "active"
            );


          document
            .querySelectorAll(
              ".panel"
            )
            .forEach(
              panel =>
                panel.classList
                  .add(
                    "hidden"
                  )
            );


          $(
            button.dataset.tab +
            "Panel"
          )
            .classList
            .remove(
              "hidden"
            );

        };

    }
  );


/* =========================
   ROUTE ADVISORY
========================= */

async function geocode(
  query
) {

  const response =
    await fetch(
      "https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=" +
      encodeURIComponent(
        query
      )
    );


  const results =
    await response.json();


  if (!results.length) {

    throw new Error(
      "Destination not found."
    );

  }


  return {

    lat:
      Number(
        results[0].lat
      ),

    lon:
      Number(
        results[0].lon
      ),

    name:
      results[0]
        .display_name

  };

}


$("route")
  .onclick =
  async () => {

    if (!myPosition) {

      locate();

      return;
    }


    const destination =
      $("destination")
        .value
        .trim();


    if (!destination)
      return;


    $("routeState")
      .textContent =
      "Planning...";


    try {

      const place =
        await geocode(
          destination
        );


      const response =
        await fetch(
          `https://router.project-osrm.org/route/v1/driving/${myPosition.lon},${myPosition.lat};${place.lon},${place.lat}?overview=full&geometries=geojson`
        );


      const data =
        await response.json();


      const route =
        data.routes[0];


      if (routeLayer) {

        map.removeLayer(
          routeLayer
        );

      }


      routeLayer =
        L.geoJSON(
          route.geometry,
          {
            style: {
              color:
                "#55a5ff",

              weight:
                6
            }
          }
        )
        .addTo(map);


      map.fitBounds(
        routeLayer.getBounds(),
        {
          padding:
            [25, 25]
        }
      );


      const km =
        route.distance /
        1000;


      const minutes =
        Math.round(
          route.duration /
          60
        );


      $("routeInfo")
        .innerHTML =

        `<div class="stats">

          <div class="stat">
            <b>
              ${km.toFixed(1)} km
            </b>
            <span>
              Distance
            </span>
          </div>

          <div class="stat">
            <b>
              ${
                minutes < 60
                  ? minutes +
                    " min"
                  : Math.floor(
                      minutes / 60
                    ) +
                    " hr " +
                    (
                      minutes % 60
                    ) +
                    " min"
              }
            </b>

            <span>
              Estimated drive time
            </span>
          </div>

        </div>

        <div class="advice">

          <b>
            Route Advisory:
          </b>

          Check fuel,
          public transport,
          ATM and emergency
          services before travelling.

        </div>`;


      $("routeState")
        .textContent =
        "Ready";


    }

    catch (error) {

      $("routeInfo")
        .textContent =
        error.message;

      $("routeState")
        .textContent =
        "Error";

    }

  };


/* =========================
   NEARBY
========================= */

const nearbyTypes = {

  metro:
    [
      "🚇",
      "Metro",
      `["railway"="station"]["station"="subway"]`
    ],

  bus:
    [
      "🚌",
      "Bus",
      `["highway"="bus_stop"]`
    ],

  fuel:
    [
      "⛽",
      "Fuel",
      `["amenity"="fuel"]`
    ],

  atm:
    [
      "🏧",
      "ATM",
      `["amenity"="atm"]`
    ]

};


function calculateDistance(
  a,
  b
) {

  const R =
    6371;


  const dLat =
    (b.lat - a.lat) *
    Math.PI / 180;


  const dLon =
    (b.lon - a.lon) *
    Math.PI / 180;


  const x =
    Math.sin(
      dLat / 2
    ) ** 2 +

    Math.cos(
      a.lat *
      Math.PI / 180
    ) *

    Math.cos(
      b.lat *
      Math.PI / 180
    ) *

    Math.sin(
      dLon / 2
    ) ** 2;


  return (
    2 *
    R *
    Math.asin(
      Math.sqrt(x)
    )
  );

}


async function findNearby(
  type
) {

  if (!myPosition) {

    locate();

    return;
  }


  const [
    icon,
    name,
    filter
  ] =
    nearbyTypes[type];


  $("nearbyResults")
    .textContent =
    "Searching...";


  const query =
    `[out:json][timeout:15];

    (
      node(
        around:3000,
        ${myPosition.lat},
        ${myPosition.lon}
      )
      ${filter};

      way(
        around:3000,
        ${myPosition.lat},
        ${myPosition.lon}
      )
      ${filter};
    );

    out center tags;`;


  try {

    const response =
      await fetch(
        "https://overpass-api.de/api/interpreter",
        {
          method:
            "POST",

          body:
            query
        }
      );


    const data =
      await response.json();


    nearbyLayer
      .clearLayers();


    const places =
      data.elements
        .map(
          element => {

            const lat =
              element.lat ||
              element.center?.lat;


            const lon =
              element.lon ||
              element.center?.lon;


            const tags =
              element.tags ||
              {};


            return {

              lat,

              lon,

              name:
                tags.name ||
                tags.brand ||
                name,

              distance:
                calculateDistance(
                  myPosition,
                  {
                    lat,
                    lon
                  }
                )

            };

          }
        )
        .filter(
          place =>
            Number.isFinite(
              place.lat
            ) &&
            Number.isFinite(
              place.lon
            )
        )
        .sort(
          (a, b) =>
            a.distance -
            b.distance
        )
        .slice(
          0,
          10
        );


    if (!places.length) {

      $("nearbyResults")
        .textContent =
        "No nearby results found.";

      return;

    }


    $("nearbyResults")
      .innerHTML =
      places
        .map(
          (place, index) =>

            `<div class="place">

              <div>

                <b>
                  ${icon}
                  ${place.name}
                </b>

                <small>
                  ${
                    place.distance < 1

                      ? Math.round(
                          place.distance *
                          1000
                        ) +
                        " m"

                      : place.distance
                          .toFixed(1) +
                        " km"
                  }
                </small>

              </div>

              <button
                data-index="${index}"
              >
                Show
              </button>

            </div>`

        )
        .join("");


    places.forEach(
      place => {

        nearbyLayer.addLayer(

          L.marker([
            place.lat,
            place.lon
          ])
          .bindPopup(
            place.name
          )

        );

      }
    );


    $("nearbyResults")
      .querySelectorAll(
        "button"
      )
      .forEach(
        button => {

          button.onclick =
            () => {

              const place =
                places[
                  Number(
                    button.dataset.index
                  )
                ];


              map.setView(
                [
                  place.lat,
                  place.lon
                ],
                17
              );

            };

        }
      );

  }

  catch (error) {

    $("nearbyResults")
      .textContent =
      "Nearby search failed.";

  }

}


document
  .querySelectorAll(
    ".nearby button"
  )
  .forEach(
    button => {

      button.onclick =
        () => {

          document
            .querySelectorAll(
              ".nearby button"
            )
            .forEach(
              b =>
                b.classList
                  .remove(
                    "active"
                  )
            );


          button
            .classList
            .add(
              "active"
            );


          findNearby(
            button.dataset.kind
          );

        };

    }
  );


$("refresh")
  .onclick =
  () => {

    const active =
      document.querySelector(
        ".nearby button.active"
      );


    if (active) {

      findNearby(
        active.dataset.kind
      );

    }

  };


/* =========================
   START
========================= */

locate();

registerSafeId();
