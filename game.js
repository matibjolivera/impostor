/* ============================================
   CONFIG SUPABASE
============================================ */
const SUPABASE_URL = window.SUPABASE_URL;
const SUPABASE_KEY = window.SUPABASE_KEY;
const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

console.log("[INIT] Script cargado");

/* ============================================
   VARIABLES GLOBALES
============================================ */
let ROOM_ID = null;
let ROOM_CODE = null;
let PLAYER_ID = null;
let IS_HOST = false;

/* ============================================
   CREAR SALA
============================================ */
async function crearSala() {
    console.log("[CREAR SALA]");

    const code = Math.floor(Math.random() * 90000) + 10000;

    const {data: room} = await supabase
        .from("rooms")
        .insert({
            code,
            started: false,
            impostors_count: 1,
            voting: false,
            estado: null,
            resultado_texto: null
        })
        .select()
        .single();

    console.log("[CREAR SALA] Room creada:", room);

    ROOM_ID = room.id;
    ROOM_CODE = room.code;
    IS_HOST = true;

    const hostName = prompt("Ingresá tu nombre (host):");

    const {data: player} = await supabase
        .from("players")
        .insert({
            room_id: ROOM_ID,
            name: hostName,
            alive: true
        })
        .select()
        .single();

    console.log("[CREAR SALA] Host creado:", player);

    PLAYER_ID = player.id;

    mostrarConfigSala();
    entrarSala();
}

/* ============================================
   CONFIG HOST
============================================ */
function mostrarConfigSala() {
    console.log("[UI] Mostrar config host");

    document.getElementById("stepHostConfig").style.display = "block";

    const div = document.getElementById("categorias");
    div.innerHTML = "";

    Object.keys(window.PERSONAJES).forEach(cat => {
        div.innerHTML += `
            <div class="form-check">
              <input class="form-check-input" type="checkbox" value="${cat}" id="cat_${cat}">
              <label class="form-check-label" for="cat_${cat}">${cat}</label>
            </div>`;
    });
}

/* ============================================
   UNIRSE A SALA
============================================ */
async function unirseSala() {
    console.log("[UNIRSE] Intentando unirse...");

    const code = document.getElementById("join_code").value;
    const name = document.getElementById("join_name").value;

    const {data: room} = await supabase
        .from("rooms")
        .select("*")
        .eq("code", code)
        .single();

    if (!room) {
        alert("Sala no encontrada");
        return;
    }

    console.log("[UNIRSE] Room encontrada:", room);

    ROOM_ID = room.id;
    ROOM_CODE = room.code;
    IS_HOST = false;

    const {data: player} = await supabase
        .from("players")
        .insert({
            room_id: ROOM_ID,
            name,
            alive: true
        })
        .select()
        .single();

    console.log("[UNIRSE] Player creado:", player);

    PLAYER_ID = player.id;

    entrarSala();
}

/* ============================================
   ENTRAR A LA SALA
============================================ */
function entrarSala() {
    console.log("[UI] Entrando a sala", ROOM_CODE);

    document.getElementById("stepCreate").style.display = "none";
    document.getElementById("stepJoin").style.display = "none";
    document.getElementById("stepGame").style.display = "block";

    document.getElementById("room_code_display").innerHTML = "Sala: " + ROOM_CODE;

    if (IS_HOST) {
        console.log("[HOST] Mostrar controles host");
        document.getElementById("stepHostConfig").style.display = "block";
        document.getElementById("hostControls").style.display = "block";
    } else {
        console.log("[PLAYER] Ocultar controles host");
        document.getElementById("stepHostConfig").style.display = "none";
        document.getElementById("hostControls").style.display = "none";
    }

    escucharJugadores();
    escucharPartida();
    escucharVotos();
    setTimeout(mostrarRol, 100);
}

/* ============================================
   ESCUCHAR JUGADORES
============================================ */
function escucharJugadores() {
    console.log("[RT] Suscribiendo a players...");

    supabase.channel("room_players_" + ROOM_ID)
        .on("postgres_changes", {
            event: "*",
            schema: "public",
            table: "players",
            filter: "room_id=eq." + ROOM_ID
        }, actualizarJugadores)
        .subscribe();

    actualizarJugadores();
}

async function actualizarJugadores() {
    const {data: players} = await supabase
        .from("players")
        .select("*")
        .eq("room_id", ROOM_ID)
        .eq("alive", true);

    document.getElementById("playersList").innerHTML =
        players.map(p => p.name + (p.id === PLAYER_ID ? " (vos)" : "")).join("<br>");
}

/* ============================================
   INICIAR JUEGO
============================================ */
async function iniciarJuego() {
    if (!IS_HOST) return;

    showMessage("🔄 Preparando partida… asignando roles, palabra y reiniciando estado…");

    await new Promise(r => setTimeout(r, 200)); // pequeño delay visual

    console.log("[JUEGO] Iniciando...");

    document.getElementById("stepHostConfig").style.display = "none";

    const seleccionadas = [...document.querySelectorAll("#categorias input:checked")].map(i => i.value);

    if (seleccionadas.length === 0) {
        alert("Seleccioná al menos una categoría");
        return;
    }

    let pool = [];
    seleccionadas.forEach(cat => pool = pool.concat(window.PERSONAJES[cat]));

    const impostorsCount = parseInt(document.getElementById("impostoresCount").value);

    const {data: players} = await supabase
        .from("players")
        .select("*")
        .eq("room_id", ROOM_ID);

    await supabase.from("players").update({alive: true}).eq("room_id", ROOM_ID);

    const palabra = pool[Math.floor(Math.random() * pool.length)];

    let vivos = [...players];
    let impostores = [];

    for (let i = 0; i < impostorsCount; i++) {
        const idx = Math.floor(Math.random() * vivos.length);
        impostores.push(vivos[idx].id);
        vivos.splice(idx, 1);
    }

    console.log("[JUEGO] Impostor(es):", impostores);

    for (const p of players) {
        await supabase
            .from("players")
            .update({role: impostores.includes(p.id) ? "impostor" : "player"})
            .eq("id", p.id);
    }

    await supabase.from("rooms")
        .update({
            started: true,
            word: palabra,
            voting: false,
            estado: null,
            resultado_texto: null
        })
        .eq("id", ROOM_ID);

    document.getElementById("startVoteControls").style.display = "block";

    await mostrarRol();
    hideMessage();
}

/* ============================================
   ESCUCHAR CAMBIOS ROOM
============================================ */
function escucharPartida() {
    console.log("[RT] Suscribiendo a room...");

    supabase.channel("room_status_" + ROOM_ID)
        .on("postgres_changes", {
            event: "*",
            schema: "public",
            table: "rooms",
            filter: "id=eq." + ROOM_ID
        }, processRoomUpdate)
        .subscribe();
}

async function processRoomUpdate() {
    console.log("[RT] Actualización room");

    const {data: room} = await supabase
        .from("rooms")
        .select("*")
        .eq("id", ROOM_ID)
        .single();

    if (room.started) await mostrarRol();

    if (room.voting) {
        console.log("[VOTACION] Activa");
        await mostrarPanelVotacion();
        await actualizarEstadoVotacion();
    } else {
        document.getElementById("voteArea").style.display = "none";
    }

    if (room.resultado_texto) {
        console.log("[RESULTADO] Mostrar resultado global");
        mostrarResultadoGlobal(room.resultado_texto);
    }

    if (room.estado === "continua") {
        if (IS_HOST) document.getElementById("newRoundControls").style.display = "block";
    }

    if (!room.started && !room.voting) {
        console.log("[UI] Volviendo a lobby");
        resetUIVotacion();

        if (IS_HOST) {
            document.getElementById("stepHostConfig").style.display = "block";
            document.getElementById("hostControls").style.display = "block";
        }
    }

    if (!IS_HOST) {
        document.getElementById("hostControls").style.display = "none";
        document.getElementById("startVoteControls").style.display = "none";
        document.getElementById("newRoundControls").style.display = "none";
    }
}

/* ============================================
   MOSTRAR ROL
============================================ */
async function mostrarRol() {
    const {data: me} = await supabase
        .from("players")
        .select("*")
        .eq("id", PLAYER_ID)
        .single();

    const {data: room} = await supabase
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
   INICIAR VOTACIÓN
============================================ */
async function iniciarVotacion() {
    if (!IS_HOST) return;

    showMessage("🗳️ Iniciando votación… limpiando votos anteriores…");

    await supabase.from("votes").delete().eq("room_id", ROOM_ID);

    await supabase.from("rooms")
        .update({
            voting: true,
            estado: null,
            resultado_texto: null
        })
        .eq("id", ROOM_ID);

    await resetUIVotacion();
    await new Promise(r => setTimeout(r, 200));

    hideMessage();
}

/* ============================================
   MOSTRAR PANEL
============================================ */
async function mostrarPanelVotacion() {
    showMessage("🎯 Cargando panel de votación…");

    limpiarUIVotos();
    document.getElementById("voteArea").style.display = "block";

    const {data: players} = await supabase
        .from("players")
        .select("*")
        .eq("room_id", ROOM_ID)
        .eq("alive", true);

    await new Promise(r => setTimeout(r, 150));

    hideMessage();

    let html = "";
    players.forEach(p => {
        if (p.id !== PLAYER_ID) {
            html += `<button class="btn btn-outline-primary w-100 my-1"
                        onclick="votar('${p.id}')">${p.name}</button>`;
        }
    });

    document.getElementById("votePlayers").innerHTML = html;

    await actualizarEstadoVotacion();
}

/* ============================================
   ACTUALIZAR VOTACIÓN
============================================ */
async function actualizarEstadoVotacion() {
    console.log("[VOTACION] Actualizando estado...");

    const {data: votos} = await supabase
        .from("votes")
        .select("*")
        .eq("room_id", ROOM_ID);

    const {data: players} = await supabase
        .from("players")
        .select("*")
        .eq("room_id", ROOM_ID);

    if (!votos.length) {
        console.log("[VOTACION] No hay votos todavía");
        document.getElementById("voteResults").style.display = "none";
        return;
    }

    // Voto propio
    const miVoto = votos.find(v => v.voter_id === PLAYER_ID);

    if (miVoto) {
        const t = players.find(p => p.id === miVoto.target_id);
        document.getElementById("votoPropioBox").style.display = "block";
        document.getElementById("votoPropioBox").innerHTML = `🗳️ Votaste a <b>${t.name}</b>`;
        document.querySelectorAll("#votePlayers button").forEach(b => b.disabled = true);
    }

    // Mostrar votos
    let html = "<h4>Votos</h4>";
    votos.forEach(v => {
        const votante = players.find(p => p.id === v.voter_id);
        const elegido = players.find(p => p.id === v.target_id);
        html += `<div class="vote-card">${votante.name} → <b>${elegido.name}</b></div>`;
    });

    document.getElementById("voteResults").innerHTML = html;
    document.getElementById("voteResults").style.display = "block";

    // Quién falta
    const vivos = players.filter(p => p.alive);
    const idsVotaron = votos.map(v => v.voter_id);

    const faltan = vivos.filter(p => !idsVotaron.includes(p.id));

    if (faltan.length) {
        document.getElementById("quienFaltaBox").style.display = "block";
        document.getElementById("quienFaltaBox").innerHTML =
            faltan.map(f => "• " + f.name).join("<br>");
    } else {
        document.getElementById("quienFaltaBox").style.display = "none";
    }
}

/* ============================================
   ESCUCHAR VOTOS
============================================ */
function escucharVotos() {
    console.log("[RT] Suscribiendo a votos...");

    supabase.channel("room_votes_" + ROOM_ID)
        .on("postgres_changes", {
            event: "*", schema: "public",
            table: "votes",
            filter: "room_id=eq." + ROOM_ID
        }, actualizarEstadoVotacion)
        .subscribe();
}

/* ============================================
   VOTAR
============================================ */
async function votar(targetId) {
    showMessage("📨 Enviando tu voto…");
    console.log("[VOTAR] Player vota:", PLAYER_ID, "->", targetId);

    await supabase.from("votes").insert({
        room_id: ROOM_ID,
        voter_id: PLAYER_ID,
        target_id: targetId
    });

    showMessage("📨 Enviando tu voto…");

    document.getElementById("votePlayers").innerHTML =
        `<p class="text-success">⏳ Esperando al resto...</p>`;

    await actualizarEstadoVotacion();
    await checkVotacionCompleta();
}

/* ============================================
   CHECK SI TERMINÓ VOTACIÓN
============================================ */
async function checkVotacionCompleta() {
    console.log("[CHECK] Revisando si votaron todos...");

    const {data: vivos} = await supabase
        .from("players")
        .select("id")
        .eq("room_id", ROOM_ID)
        .eq("alive", true);

    const {data: votos} = await supabase
        .from("votes")
        .select("voter_id")
        .eq("room_id", ROOM_ID);

    const votantesUnicos = [...new Set(votos.map(v => v.voter_id))];

    console.log("[CHECK] Vivos:", vivos.length, "Votaron:", votantesUnicos.length);

    if (votantesUnicos.length === vivos.length && IS_HOST) {
        console.log("[CHECK] Todos votaron → Finalizar");
        await finalizarVotacion();
    }
}

/* ============================================
   FINALIZAR VOTACIÓN
============================================ */
async function finalizarVotacion() {
    console.log("[FIN] Finalizando votación...");

    const {data: votos} = await supabase.from("votes")
        .select("*")
        .eq("room_id", ROOM_ID);

    const {data: players} = await supabase.from("players")
        .select("*")
        .eq("room_id", ROOM_ID);

    let conteo = {};
    votos.forEach(v => conteo[v.target_id] = (conteo[v.target_id] || 0) + 1);

    let elId = null;
    let max = -1;

    players.forEach(p => {
        const cant = conteo[p.id] || 0;
        if (cant > max) {
            max = cant;
            elId = p.id;
        }
    });

    const eliminado = players.find(p => p.id === elId);

    await supabase.from("players")
        .update({alive: false})
        .eq("id", elId);

    console.log("[FIN] Eliminado:", eliminado.name, "Rol:", eliminado.role);

    if (eliminado.role === "impostor") {
        await supabase.from("rooms")
            .update({
                estado: "impostor_encontrado",
                resultado_texto: `🚨 IMPOSTOR ENCONTRADO 🚨<br>Era <b>${eliminado.name}</b>`,
                voting: false
            })
            .eq("id", ROOM_ID);

        return;
    }

    const {data: vivosRestantes} = await supabase
        .from("players")
        .select("*")
        .eq("room_id", ROOM_ID)
        .eq("alive", true);

    if (vivosRestantes.length === 2) {
        const imp = vivosRestantes.find(p => p.role === "impostor");

        await supabase.from("rooms")
            .update({
                estado: "gano_impostor",
                resultado_texto: `🎉 GANÓ EL IMPOSTOR 🎉<br>Era <b>${imp.name}</b>`,
                voting: false
            })
            .eq("id", ROOM_ID);

        return;
    }

    await supabase.from("rooms")
        .update({
            estado: "continua",
            resultado_texto: `${eliminado.name} fue eliminado. La partida continúa.`,
            voting: false
        })
        .eq("id", ROOM_ID);
}

/* ============================================
   MOSTRAR RESULTADO GLOBAL
============================================ */
function mostrarResultadoGlobal(html) {
    console.log("[UI] Mostrar resultado global");

    document.getElementById("voteArea").style.display = "none";
    document.getElementById("voteResults").innerHTML = html;
    document.getElementById("voteResults").style.display = "block";
}

/* ============================================
   NUEVA RONDA
============================================ */
async function nuevaRonda() {
    console.log("[RONDA] Nueva ronda...");

    showMessage("🔄 Comenzando nueva ronda… reiniciando jugadores y estado…");

    if (!IS_HOST) return;

    await supabase.from("rooms")
        .update({
            started: false,
            word: null,
            voting: false,
            estado: null,
            resultado_texto: null
        })
        .eq("id", ROOM_ID);

    await supabase.from("players")
        .update({alive: true, role: null})
        .eq("room_id", ROOM_ID);

    resetUIVotacion();

    await new Promise(r => setTimeout(r, 250));

    hideMessage();

    document.getElementById("stepHostConfig").style.display = "block";
    document.getElementById("hostControls").style.display = "block";
    document.getElementById("newRoundControls").style.display = "none";
}

/* ============================================
   UI HELPERS
============================================ */
function resetUIVotacion() {
    console.log("[UI] Reset votación");

    document.getElementById("votePlayers").innerHTML = "";
    document.getElementById("votePlayers").style.display = "block";

    document.getElementById("votoPropioBox").style.display = "none";
    document.getElementById("votoPropioBox").innerHTML = "";

    document.getElementById("quienFaltaBox").style.display = "none";
    document.getElementById("quienFaltaBox").innerHTML = "";

    document.getElementById("voteResults").style.display = "none";
    document.getElementById("voteResults").innerHTML = "";

    document.getElementById("votosEnVivo").style.display = "none";
    document.getElementById("votosLista").innerHTML = "";
}

function limpiarUIVotos() {
    console.log("[UI] Limpiando panel de votos");

    document.getElementById("votePlayers").innerHTML = "";
    document.getElementById("votoPropioBox").innerHTML = "";
    document.getElementById("votoPropioBox").style.display = "none";
    document.getElementById("voteResults").innerHTML = "";
    document.getElementById("quienFaltaBox").innerHTML = "";
}

function showMessage(msg) {
    const box = document.getElementById("systemMessage");
    box.innerHTML = msg;
    box.style.display = "block";
}

function hideMessage() {
    const box = document.getElementById("systemMessage");
    box.style.display = "none";
    box.innerHTML = "";
}
