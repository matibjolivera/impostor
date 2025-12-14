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
let VOTO_REALIZADO = null; // 🔥 NUEVO

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
            voting: false,
            estado: null,
            resultado_texto: null
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
    entrarSala();
}

/* ============================================
   CONFIG HOST
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
    document.getElementById("stepGame").style.display = "block";

    document.getElementById("room_code_display").innerHTML = "Sala: " + ROOM_CODE;

    if (IS_HOST) document.getElementById("stepHostConfig").style.display = "block";
    else document.getElementById("stepHostConfig").style.display = "none";

    escucharJugadores();
    escucharPartida();
    escucharVotos();
    setTimeout(mostrarRol, 100);
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

async function actualizarVotosEnVivo() {

    let {data: votos} = await supabase
        .from("votes")
        .select("*")
        .eq("room_id", ROOM_ID);

    let {data: players} = await supabase
        .from("players")
        .select("*")
        .eq("room_id", ROOM_ID);

    if (!votos.length) return;

    document.getElementById("votosEnVivo").style.display = "block";

    let html = "";
    votos.forEach(v => {
        const voter = players.find(p => p.id === v.voter_id);
        const target = players.find(p => p.id === v.target_id);

        if (voter && target) {
            html += `<div>🗳️ <b>${voter.name}</b> votó a <b>${target.name}</b></div>`;
        }
    });

    document.getElementById("votosLista").innerHTML = html;
}

async function actualizarEstadoVotacion() {
    if (!document.getElementById("voteArea").style.display.includes("block")) {
        return;
    }

    let {data: votos} = await supabase
        .from("votes")
        .select("*")
        .eq("room_id", ROOM_ID);

    let {data: players} = await supabase
        .from("players")
        .select("*")
        .eq("room_id", ROOM_ID);

    /* ---------------------------
       Encontrar mi voto
    ----------------------------*/
    const miVoto = votos.find(v => v.voter_id === PLAYER_ID);
    if (miVoto) {
        const target = players.find(p => p.id === miVoto.target_id);

        document.getElementById("votoPropioBox").style.display = "block";
        document.getElementById("votoPropioBox").innerHTML =
            `🗳️ Votaste a: <b>${target.name}</b>`;
    }

    /* ---------------------------
       Bloquear botones tras votar
    ----------------------------*/
    if (miVoto) {
        document.querySelectorAll("#votePlayers button").forEach(btn => {
            btn.disabled = true;
        });
    }

    /* ---------------------------
       Mostrar quién votó a quién
    ----------------------------*/
    let votosHTML = "<h4>Votos</h4>";
    votos.forEach(v => {
        const votante = players.find(p => p.id === v.voter_id);
        const elegido = players.find(p => p.id === v.target_id);
        votosHTML += `<div class="vote-card">${votante.name} → <b>${elegido.name}</b></div>`;
    });
    document.getElementById("voteResults").innerHTML = votosHTML;

    /* ---------------------------
       Mostrar quién falta votar
    ----------------------------*/
    let vivos = players.filter(p => p.alive === true);
    let idsQueVotaron = votos.map(v => v.voter_id);

    let faltan = vivos.filter(p => !idsQueVotaron.includes(p.id));

    if (faltan.length > 0) {
        document.getElementById("quienFaltaBox").style.display = "block";
        document.getElementById("quienFaltaBox").innerHTML =
            "⏳ Faltan votar:<br>" + faltan.map(f => "• " + f.name).join("<br>");
    } else {
        document.getElementById("quienFaltaBox").style.display = "none";
    }
}

function escucharVotos() {
    supabase
        .channel("votes_room_" + ROOM_ID)
        .on(
            "postgres_changes",
            {event: "*", schema: "public", table: "votes", filter: "room_id=eq." + ROOM_ID},
            actualizarVotosEnVivo
        )
        .subscribe();
}


/* ============================================
   INICIAR JUEGO
============================================ */
async function iniciarJuego() {
    if (!IS_HOST) return;

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
            voting: false,
            estado: null,
            resultado_texto: null
        })
        .eq("id", ROOM_ID);

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

/* ============================================
   ESCUCHAR VOTOS EN TIEMPO REAL
============================================ */
function escucharVotos() {
    supabase
        .channel("room_votes_" + ROOM_ID)
        .on(
            "postgres_changes",
            {
                event: "*",
                schema: "public",
                table: "votes",
                filter: "room_id=eq." + ROOM_ID
            },
            actualizarEstadoVotacion
        )
        .subscribe();
}


async function processRoomUpdate() {

    const { data: room } = await supabase
        .from("rooms")
        .select("*")
        .eq("id", ROOM_ID)
        .single();

    // 1) Si la partida comenzó, mostrar rol
    if (room.started) {
        mostrarRol();
    }

    // 2) Si está en votación, mostrar panel
    if (room.voting) {
        mostrarPanelVotacion();
    } else {
        document.getElementById("voteArea").style.display = "none";
    }

    // 3) Si hay un resultado final, mostrarlo
    if (room.resultado_texto) {
        mostrarResultadoGlobal(room.resultado_texto);
    }

    // 4) Si la partida continúa (alguien eliminado pero no se terminó)
    if (room.estado === "continua") {
        document.getElementById("newRoundControls").style.display = "block";
    }

    // 5) Si la partida NO está iniciada y no está votando → volver a pantalla host
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
   INICIAR VOTACIÓN
============================================ */
async function iniciarVotacion() {
    if (!IS_HOST) return;

    VOTO_REALIZADO = null;

    await supabase.from("votes").delete().eq("room_id", ROOM_ID);

    await supabase
        .from("rooms")
        .update({
            voting: true,
            estado: null,
            resultado_texto: null
        })
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

    mostrarEstadoVotos(); // 🔥 NUEVO
}

async function mostrarEstadoVotos() {

    let {data: players} = await supabase
        .from("players")
        .select("*")
        .eq("room_id", ROOM_ID);

    let {data: votos} = await supabase
        .from("votes")
        .select("*")
        .eq("room_id", ROOM_ID);

    let html = "<hr><h5>Estado de votos</h5>";

    players.forEach(p => {
        const voto = votos.find(v => v.voter_id === p.id);

        if (voto) {
            let target = players.find(t => t.id === voto.target_id);
            html += `<div>${p.name} votó a <b>${target.name}</b></div>`;
        } else {
            html += `<div>${p.name} <span class="text-danger">(falta votar)</span></div>`;
        }
    });

    document.getElementById("votePlayers").innerHTML += html;
}

/* ============================================
   VOTAR
============================================ */
async function votar(targetId) {

    await supabase.from("votes").insert({
        room_id: ROOM_ID,
        voter_id: PLAYER_ID,
        target_id: targetId
    });

    // Ocultar botones
    document.getElementById("votePlayers").innerHTML =
        `<p class="text-success">⏳ Esperando al resto...</p>`;

    // Mostrar a quién votaste
    let {data: players} = await supabase
        .from("players")
        .select("*")
        .eq("room_id", ROOM_ID);

    const target = players.find(p => p.id === targetId);

    document.getElementById("votoPropioBox").style.display = "block";
    document.getElementById("votoPropioBox").innerHTML =
        `🗳️ Votaste a <b>${target.name}</b>`;

    await checkVotacionCompleta();
}

function bloquearVotacion() {
    document.querySelectorAll("#votePlayers button")
        .forEach(b => b.disabled = true);
}

function mostrarVotoPropio() {
    document.getElementById("votePlayers").innerHTML =
        `<h4 class="text-success">Votaste a: <b>${VOTO_REALIZADO}</b></h4>`;
}

/* ============================================
   CHECK VOTACIÓN COMPLETA
============================================ */
async function checkVotacionCompleta() {

    let { data: vivos } = await supabase
        .from("players")
        .select("id")
        .eq("room_id", ROOM_ID)
        .eq("alive", true);

    let { data: votos } = await supabase
        .from("votes")
        .select("voter_id")
        .eq("room_id", ROOM_ID);

    // Evitar duplicados por seguridad
    const votantesUnicos = [...new Set(votos.map(v => v.voter_id))];

    if (votantesUnicos.length === vivos.length) {
        console.log("✔ Todos votaron:", votantesUnicos.length);
        if (IS_HOST) {
            finalizarVotacion();
        }
    } else {
        console.log("⏳ Faltan votos:", vivos.length - votantesUnicos.length);
    }
}

/* ============================================
   FINALIZAR VOTACIÓN
============================================ */
async function finalizarVotacion() {

    // Traemos votos
    const { data: votos } = await supabase
        .from("votes")
        .select("*")
        .eq("room_id", ROOM_ID);

    // Traemos TODOS los players (no solo vivos)
    const { data: players } = await supabase
        .from("players")
        .select("*")
        .eq("room_id", ROOM_ID);

    // Conteo
    let conteo = {};
    votos.forEach(v => {
        conteo[v.target_id] = (conteo[v.target_id] || 0) + 1;
    });

    // Elegir eliminado
    let eliminadoId = null;
    let max = -1;

    players.forEach(p => {
        const v = conteo[p.id] || 0;
        if (v > max) {
            max = v;
            eliminadoId = p.id;
        }
    });

    // Encontrar player eliminado
    const eliminado = players.find(p => p.id === eliminadoId);

    // Marcarlo eliminado
    await supabase
        .from("players")
        .update({ alive: false })
        .eq("id", eliminadoId);

    // Caso impostor muerto
    if (eliminado.role === "impostor") {

        await supabase
            .from("rooms")
            .update({
                estado: "impostor_encontrado",
                resultado_texto: `🚨 IMPOSTOR ENCONTRADO 🚨<br>Era <b>${eliminado.name}</b>`,
                voting: false
            })
            .eq("id", ROOM_ID);

        return;
    }

    // Recalcular vivos restantes luego de eliminar
    const { data: vivosRestantes } = await supabase
        .from("players")
        .select("*")
        .eq("room_id", ROOM_ID)
        .eq("alive", true);

    // Caso: impostor gana
    if (vivosRestantes.length === 2) {
        const impostor = vivosRestantes.find(p => p.role === "impostor");

        await supabase
            .from("rooms")
            .update({
                estado: "gano_impostor",
                resultado_texto: `🎉 GANÓ EL IMPOSTOR 🎉<br>Era <b>${impostor.name}</b>`,
                voting: false
            })
            .eq("id", ROOM_ID);

        return;
    }

    // Caso: partida continúa
    await supabase
        .from("rooms")
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

    await supabase
        .from("rooms")
        .update({
            started: false,
            word: null,
            voting: false,
            estado: null,
            resultado_texto: null
        })
        .eq("id", ROOM_ID);

    await supabase
        .from("players")
        .update({alive: true, role: null})
        .eq("room_id", ROOM_ID);

    document.getElementById("voteArea").style.display = "none";
    document.getElementById("voteResults").style.display = "none";
    document.getElementById("yourRole").innerHTML = "";

    document.getElementById("stepHostConfig").style.display = "block";
    document.getElementById("hostControls").style.display = "block";
    document.getElementById("newRoundControls").style.display = "none";
}
