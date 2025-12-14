/* ============================================
   CONFIG SUPABASE
============================================ */
const SUPABASE_URL = window.SUPABASE_URL;
const SUPABASE_KEY = window.SUPABASE_KEY;

const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

/* ============================================
   VARIABLES GLOBALES
============================================ */
let ROOM_ID = null;
let ROOM_CODE = null;
let PLAYER_ID = null;
let IS_HOST = false;

let voteInterval = null;
let voteTime = 20;

/* ============================================
   CREAR SALA
============================================ */
async function crearSala() {
    const code = Math.floor(Math.random() * 90000) + 10000;

    let {data: room} = await supabase
        .from("rooms")
        .insert({
            code,
            started: false,
            impostors_count: 1,
            voting: false
        })
        .select()
        .single();

    ROOM_ID = room.id;
    ROOM_CODE = room.code;
    IS_HOST = true;

    const hostName = prompt("Ingresá tu nombre (host):");

    let {data: player} = await supabase
        .from("players")
        .insert({
            room_id: ROOM_ID,
            name: hostName,
            alive: true
        })
        .select()
        .single();

    PLAYER_ID = player.id;

    mostrarConfigSala();

    // 🔥 NECESARIO PARA MOSTRAR PANTALLA DE SALA
    entrarSala();
}

/* ============================================
   CONFIG DEL HOST
============================================ */
function mostrarConfigSala() {
    document.getElementById("stepHostConfig").style.display = "block";

    const div = document.getElementById("categorias");
    div.innerHTML = "";

    Object.keys(window.PERSONAJES).forEach(cat => {
        div.innerHTML += `
            <div class="form-check">
              <input class="form-check-input" type="checkbox" value="${cat}" id="cat_${cat}">
              <label class="form-check-label" for="cat_${cat}">
                ${cat}
              </label>
            </div>
        `;
    });
}

/* ============================================
   UNIRSE A SALA
============================================ */
async function unirseSala() {
    const code = document.getElementById("join_code").value;
    const name = document.getElementById("join_name").value;

    let {data: room} = await supabase
        .from("rooms")
        .select("*")
        .eq("code", code)
        .single();

    if (!room) {
        alert("Sala no encontrada");
        return;
    }

    ROOM_ID = room.id;
    ROOM_CODE = room.code;
    IS_HOST = false;

    let {data: player} = await supabase
        .from("players")
        .insert({
            room_id: ROOM_ID,
            name,
            alive: true
        })
        .select()
        .single();

    PLAYER_ID = player.id;

    entrarSala();
}

/* ============================================
   ENTRAR A LA SALA
============================================ */
function entrarSala() {
    document.getElementById("stepCreate").style.display = "none";
    document.getElementById("stepJoin").style.display = "none";

    // siempre mostrar stepGame
    document.getElementById("stepGame").style.display = "block";
    document.getElementById("room_code_display").innerHTML = "Sala: " + ROOM_CODE;

    // 👇 MOSTRAR CONFIGURACION SOLO SI ES HOST
    if (IS_HOST) {
        document.getElementById("stepHostConfig").style.display = "block";
    } else {
        document.getElementById("stepHostConfig").style.display = "none";
    }

    escucharJugadores();
    escucharPartida();
    setTimeout(mostrarRol, 500);
}


/* ============================================
   ESCUCHAR JUGADORES
============================================ */
function escucharJugadores() {
    supabase
        .channel("room_players_" + ROOM_ID)
        .on(
            "postgres_changes",
            {event: "*", schema: "public", table: "players", filter: "room_id=eq." + ROOM_ID},
            actualizarJugadores
        )
        .subscribe();

    actualizarJugadores();
}

async function actualizarJugadores() {
    let {data: players} = await supabase
        .from("players")
        .select("*")
        .eq("room_id", ROOM_ID)
        .eq("alive", true);

    document.getElementById("playersList").innerHTML =
        players.map(p => p.name + (p.id === PLAYER_ID ? " (vos)" : "")).join("<br>");
}

/* ============================================
   INICIAR JUEGO (HOST)
============================================ */
async function iniciarJuego() {
    if (!IS_HOST) return;

    // ocultar config
    document.getElementById("stepHostConfig").style.display = "none";

    const seleccionadas = [...document.querySelectorAll("#categorias input:checked")].map(i => i.value);
    if (seleccionadas.length === 0) {
        alert("Seleccioná al menos una categoría");
        return;
    }

    let pool = [];
    seleccionadas.forEach(cat => pool = pool.concat(window.PERSONAJES[cat]));

    const impostorsCount = parseInt(document.getElementById("impostoresCount").value, 10);

    let {data: players} = await supabase
        .from("players")
        .select("*")
        .eq("room_id", ROOM_ID);

    await supabase
        .from("players")
        .update({alive: true})
        .eq("room_id", ROOM_ID);

    const palabra = pool[Math.floor(Math.random() * pool.length)];

    let impostores = [];
    let vivos = [...players];

    for (let i = 0; i < impostorsCount; i++) {
        const idx = Math.floor(Math.random() * vivos.length);
        impostores.push(vivos[idx].id);
        vivos.splice(idx, 1);
    }

    for (let p of players) {
        await supabase
            .from("players")
            .update({
                role: impostores.includes(p.id) ? "impostor" : "player"
            })
            .eq("id", p.id);
    }

    await supabase
        .from("rooms")
        .update({
            started: true,
            word: palabra,
            voting: false
        })
        .eq("id", ROOM_ID);

    // 🔥 MOSTRAR PANEL DE JUEGO CORRECTAMENTE
    document.getElementById("stepGame").style.display = "block";
    document.getElementById("hostControls").style.display = "none";
    document.getElementById("startVoteControls").style.display = "block";

    mostrarRol();
}

/* ============================================
   ESCUCHAR CAMBIOS EN ROOM
============================================ */
function escucharPartida() {
    supabase
        .channel("room_status_" + ROOM_ID)
        .on(
            "postgres_changes",
            {event: "*", schema: "public", table: "rooms", filter: "id=eq." + ROOM_ID},
            processRoomUpdate
        )
        .subscribe();
}

async function processRoomUpdate() {
    let {data: room} = await supabase
        .from("rooms")
        .select("*")
        .eq("id", ROOM_ID)
        .single();

    // Si el juego arrancó ➜ mostrar rol
    if (room.started) {
        mostrarRol();
    }

    // Si se empezó votación
    if (room.voting) {
        mostrarPanelVotacion();
    }

    // Si se reinició la sala
    if (!room.started && !room.voting) {
        document.getElementById("yourRole").innerHTML = "";
        document.getElementById("voteArea").style.display = "none";
        document.getElementById("voteResults").style.display = "none";

        if (IS_HOST) {
            document.getElementById("stepHostConfig").style.display = "block";
            document.getElementById("hostControls").style.display = "block";
        }
    }
}


/* ============================================
   MOSTRAR ROL
============================================ */
async function mostrarRol() {
    let {data: me} = await supabase
        .from("players")
        .select("*")
        .eq("id", PLAYER_ID)
        .single();

    let {data: room} = await supabase
        .from("rooms")
        .select("*")
        .eq("id", ROOM_ID)
        .single();

    if (!room.started) return;

    if (me.role === "impostor") {
        document.getElementById("yourRole").innerHTML = "🚨 SOS EL IMPOSTOR 🚨";
    } else {
        document.getElementById("yourRole").innerHTML = "Tu palabra: " + room.word;
    }
}

/* ============================================
   INICIAR VOTACIÓN (HOST)
============================================ */
async function iniciarVotacion() {
    if (!IS_HOST) return;

    await supabase.from("votes").delete().eq("room_id", ROOM_ID);

    await supabase
        .from("rooms")
        .update({voting: true})
        .eq("id", ROOM_ID);
}

/* ============================================
   MOSTRAR PANEL DE VOTACIÓN
============================================ */
async function mostrarPanelVotacion() {

    document.getElementById("voteArea").style.display = "block";
    document.getElementById("voteResults").style.display = "none";

    let {data: players} = await supabase
        .from("players")
        .select("*")
        .eq("room_id", ROOM_ID)
        .eq("alive", true);

    let html = "";
    players.forEach(p => {
        if (p.id !== PLAYER_ID) {
            html += `<button class="btn btn-outline-primary w-100 my-1"
                        onclick="votar('${p.id}')">${p.name}</button>`;
        }
    });

    document.getElementById("votePlayers").innerHTML = html;

    if (IS_HOST) iniciarTimerVotos();
}

/* ============================================
   VOTAR
============================================ */
async function votar(targetId) {
    await supabase
        .from("votes")
        .insert({
            room_id: ROOM_ID,
            voter_id: PLAYER_ID,
            target_id: targetId
        });

    alert("Voto registrado");
}

/* ============================================
   TIMER
============================================ */
function iniciarTimerVotos() {
    voteTime = 20;
    document.getElementById("voteTimer").innerText = voteTime;

    voteInterval = setInterval(async () => {
        voteTime--;
        document.getElementById("voteTimer").innerText = voteTime;

        if (voteTime <= 0) {
            clearInterval(voteInterval);
            finalizarVotacion();
        }
    }, 1000);
}

/* ============================================
   FINALIZAR VOTACIÓN
============================================ */
async function finalizarVotacion() {

    let {data: votos} = await supabase
        .from("votes")
        .select("*")
        .eq("room_id", ROOM_ID);

    let {data: players} = await supabase
        .from("players")
        .select("*")
        .eq("room_id", ROOM_ID)
        .eq("alive", true);

    let conteo = {};
    votos.forEach(v => {
        conteo[v.target_id] = (conteo[v.target_id] || 0) + 1;
    });

    let eliminadoId = null;
    let max = -1;

    players.forEach(p => {
        let votosP = conteo[p.id] || 0;
        if (votosP > max) {
            max = votosP;
            eliminadoId = p.id;
        }
    });

    await supabase
        .from("players")
        .update({alive: false})
        .eq("id", eliminadoId);

    let eliminado = players.find(p => p.id === eliminadoId);

    if (eliminado.role === "impostor") {
        mostrarResultadoGlobal(
            `🚨 IMPOSTOR ENCONTRADO 🚨<br>El impostor era <b>${eliminado.name}</b>`
        );
        return;
    }

    let {data: vivosRestantes} = await supabase
        .from("players")
        .select("*")
        .eq("room_id", ROOM_ID)
        .eq("alive", true);

    if (vivosRestantes.length === 2) {
        let impostor = vivosRestantes.find(p => p.role === "impostor");
        mostrarResultadoGlobal(
            `🎉 EL IMPOSTOR GANÓ 🎉<br>Era <b>${impostor.name}</b>`
        );
        return;
    }

    mostrarResultadoGlobal(
        `<b>${eliminado.name}</b> fue eliminado.<br>La partida continúa...`
    );
}

/* ============================================
   MOSTRAR RESULTADO GLOBAL
============================================ */
function mostrarResultadoGlobal(html) {
    document.getElementById("voteArea").style.display = "none";
    document.getElementById("voteResults").innerHTML = html;
    document.getElementById("voteResults").style.display = "block";

    if (IS_HOST) {
        document.getElementById("startVoteControls").style.display = "block";
        document.getElementById("newRoundControls").style.display = "block";
    }
}

/* ============================================
   NUEVA RONDA
============================================ */
async function nuevaRonda() {
    if (!IS_HOST) return;

    document.getElementById("startVoteControls").style.display = "none";
    document.getElementById("voteArea").style.display = "none";
    document.getElementById("voteResults").style.display = "none";

    await supabase
        .from("rooms")
        .update({
            started: false,
            word: null,
            voting: false
        })
        .eq("id", ROOM_ID);

    await supabase
        .from("players")
        .update({alive: true, role: null})
        .eq("room_id", ROOM_ID);

    document.getElementById("yourRole").innerHTML = "";
    document.getElementById("stepHostConfig").style.display = "block";
    document.getElementById("hostControls").style.display = "block";
    document.getElementById("newRoundControls").style.display = "none";
}
