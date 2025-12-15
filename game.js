/* ============================================
   CONFIG SUPABASE & GLOBALES
============================================ */
const SUPABASE_URL = window.SUPABASE_URL;
const SUPABASE_KEY = window.SUPABASE_KEY;
const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// ESTADO LOCAL
let STATE = {
    room: null,
    me: null,
    players: [],
    votes: [],
    isHost: false
};

// VISTAS
const ROUTES = {
    CREATE: 'stepCreate',
    JOIN: 'stepJoin',
    GAME: 'stepGame'
};

/* ============================================
   UI HELPERS
============================================ */
function showView(viewId) {
    [ROUTES.CREATE, ROUTES.JOIN, ROUTES.GAME, 'stepHostConfig'].forEach(id => {
        const el = document.getElementById(id);
        if(el) el.style.display = (id === viewId) ? 'block' : 'none';
    });
}

function showMessage(msg) {
    const box = document.getElementById("systemMessage");
    if (!box) return;
    box.innerHTML = msg;
    box.style.display = "block";
}

function hideMessage() {
    const box = document.getElementById("systemMessage");
    if (box) box.style.display = "none";
}

/* ============================================
   INICIO
============================================ */
async function crearSala() {
    const code = Math.floor(Math.random() * 90000) + 10000;

    // Crear Room
    const { data: room, error } = await supabase
        .from("rooms")
        .insert({
            code: code,
            started: false,
            voting: false,
            estado: null,
            resultado_texto: null,
            word: null,
            impostors_count: 1
        })
        .select()
        .single();

    if (error) {
        console.error(error);
        return alert("Error DB al crear sala: " + error.message);
    }

    // Crear Host
    const hostName = prompt("Ingresá tu nombre (Host):") || "Host";
    const { data: player, error: pError } = await supabase
        .from("players")
        .insert({
            room_id: room.id,
            name: hostName,
            alive: true,
            role: null
        })
        .select()
        .single();

    if (pError) return alert("Error DB al crear player: " + pError.message);

    iniciarSesionLocal(room, player);
}

async function unirseSala() {
    const code = document.getElementById("join_code").value;
    const name = document.getElementById("join_name").value;

    if (!code || !name) return alert("Completá código y nombre");

    // Buscar sala
    const { data: room, error } = await supabase
        .from("rooms")
        .select("*")
        .eq("code", code)
        .single();

    if (error || !room) return alert("Sala no encontrada o código incorrecto.");

    // Unirse
    const { data: player, error: pError } = await supabase
        .from("players")
        .insert({
            room_id: room.id,
            name: name,
            alive: true,
            role: null
        })
        .select()
        .single();

    if (pError) return alert("Error al unirse: " + pError.message);

    iniciarSesionLocal(room, player);
}

function iniciarSesionLocal(room, player) {
    STATE.room = room;
    STATE.me = player;

    // Determinación de Host: Si fui creado al mismo tiempo que la sala (margen de 1s) o soy el player más viejo
    STATE.isHost = (room.created_at === player.created_at) || true;

    setupRealtime();
    sincronizarEstado();
}

/* ============================================
   REALTIME (CORREGIDO)
============================================ */
function setupRealtime() {
    if (!STATE.room) return;

    // Canal único
    const channel = supabase.channel(`game_${STATE.room.id}`);

    // 1. Escuchar cambios en la SALA (Por ID, no por room_id)
    channel.on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'rooms', filter: `id=eq.${STATE.room.id}` },
        (payload) => {
            console.log("UPDATE ROOM:", payload);
            sincronizarEstado();
        }
    );

    // 2. Escuchar PLAYERS y VOTES (Por room_id)
    ['players', 'votes'].forEach(table => {
        channel.on(
            'postgres_changes',
            { event: '*', schema: 'public', table: table, filter: `room_id=eq.${STATE.room.id}` },
            (payload) => {
                console.log(`UPDATE ${table}:`, payload);
                sincronizarEstado();
            }
        );
    });

    channel.subscribe((status) => {
        if (status === 'SUBSCRIBED') {
            console.log("🟢 Realtime conectado");
        }
    });
}

async function sincronizarEstado() {
    if (!STATE.room?.id) return;

    // Recargar datos frescos
    const [rRes, pRes, vRes] = await Promise.all([
        supabase.from("rooms").select("*").eq("id", STATE.room.id).single(),
        supabase.from("players").select("*").eq("room_id", STATE.room.id).order('created_at', {ascending: true}),
        supabase.from("votes").select("*").eq("room_id", STATE.room.id)
    ]);

    if (rRes.data) STATE.room = rRes.data;
    if (pRes.data) STATE.players = pRes.data;
    if (vRes.data) STATE.votes = vRes.data;

    // Actualizar "ME"
    const updatedMe = STATE.players.find(p => p.id === STATE.me.id);
    if (updatedMe) STATE.me = updatedMe;

    // Recalcular Host: El primer jugador de la lista (el más viejo) es el host
    if (STATE.players.length > 0) {
        STATE.isHost = (STATE.me.id === STATE.players[0].id);
    }

    renderUI();

    // Lógica automática Host
    if (STATE.isHost && STATE.room.voting) {
        checkVotacionCompletaHost();
    }
}

/* ============================================
   RENDER UI
============================================ */
function renderUI() {
    showView(ROUTES.GAME);

    document.getElementById("room_code_display").innerText = `Sala: ${STATE.room.code}`;

    // Lista Jugadores
    const listHtml = STATE.players.map(p => {
        let status = p.alive ? "🙂" : "💀";
        let roleText = "";
        if (!p.alive && p.role === 'impostor') roleText = " (Impostor)";

        let meTag = (p.id === STATE.me.id) ? " <b>(Vos)</b>" : "";
        let hostTag = (STATE.players[0]?.id === p.id) ? " 👑" : "";
        let style = p.alive ? "" : "text-decoration: line-through; color: gray;";

        return `<div style="${style}">${status} ${p.name} ${roleText} ${meTag} ${hostTag}</div>`;
    }).join("");
    document.getElementById("playersList").innerHTML = listHtml;

    // Referencias
    const els = {
        hostControls: document.getElementById("hostControls"),
        startVoteControls: document.getElementById("startVoteControls"),
        newRoundControls: document.getElementById("newRoundControls"),
        yourRole: document.getElementById("yourRole"),
        voteArea: document.getElementById("voteArea"),
        voteResults: document.getElementById("voteResults"),
        eliminatedScreen: document.getElementById("eliminatedScreen")
    };

    // Resetear todo a oculto
    Object.values(els).forEach(el => el && (el.style.display = 'none'));

    // 1. MUERTO
    if (!STATE.me.alive) {
        els.eliminatedScreen.style.display = 'block';
        els.eliminatedScreen.innerHTML = "<h2>💀 ESTÁS MUERTO 💀</h2>";
    }

    // 2. LOBBY (No empezado)
    if (!STATE.room.started) {
        els.yourRole.innerHTML = "<h3>Esperando al anfitrión...</h3>";
        if (STATE.isHost) {
            els.hostControls.style.display = 'block';
            injectHostConfig(); // Inyectar checkboxes
        }
        return;
    }

    // 3. JUEGO (Roles)
    if (STATE.me.alive) {
        els.yourRole.style.display = 'block';
        if (STATE.me.role === 'impostor') {
            els.yourRole.innerHTML = `<div class="alert alert-danger fs-1">🤫 SOS EL IMPOSTOR</div>`;
        } else {
            els.yourRole.innerHTML = `<div class="alert alert-info fs-3">Tu palabra: <br><strong>${STATE.room.word}</strong></div>`;
        }
    }

    // 4. RESULTADOS FINALES
    if (STATE.room.resultado_texto && STATE.room.estado !== null) {
        els.voteResults.innerHTML = STATE.room.resultado_texto;
        els.voteResults.style.display = 'block';
        if (STATE.isHost) els.newRoundControls.style.display = 'block';
        return;
    }

    // 5. VOTACIÓN
    if (STATE.room.voting) {
        renderPanelVotacion(els);
        return;
    }

    // 6. BOTON INICIAR VOTACION (Solo Host vivo)
    if (STATE.isHost && STATE.me.alive) {
        els.startVoteControls.style.display = 'block';
    }
}

// Inyección de checkboxes
function injectHostConfig() {
    const container = document.getElementById("hostControls");
    if (!container) return;

    // Si ya existe, no duplicar
    if (document.getElementById("injected-config")) return;

    const wrapper = document.createElement("div");
    wrapper.id = "injected-config";
    wrapper.className = "mb-3 p-3 bg-white text-dark rounded border";
    wrapper.innerHTML = "<h5>⚙️ Configuración:</h5>";

    if (window.PERSONAJES) {
        Object.keys(window.PERSONAJES).forEach(cat => {
            // Checkbox checkeado por default
            wrapper.innerHTML += `
                <div class="form-check">
                  <input class="form-check-input" type="checkbox" value="${cat}" id="cat_${cat}" checked>
                  <label class="form-check-label" for="cat_${cat}">${cat}</label>
                </div>`;
        });
    } else {
        wrapper.innerHTML += "<p class='text-danger'>Error: No se cargó personajes.js</p>";
    }

    // Insertar al principio del contenedor
    container.insertBefore(wrapper, container.firstChild);
}

function renderPanelVotacion(els) {
    els.voteArea.style.display = 'block';

    const countVotos = STATE.votes.length;
    const countVivos = STATE.players.filter(p => p.alive).length;

    document.getElementById("quienFaltaBox").innerHTML = `Votos: ${countVotos} / ${countVivos}`;
    document.getElementById("quienFaltaBox").style.display = 'block';

    // Lista pública de quién votó a quién
    let htmlResult = "<h4>Votos emitidos:</h4>";
    STATE.votes.forEach(v => {
        const voter = STATE.players.find(p => p.id === v.voter_id);
        const target = STATE.players.find(p => p.id === v.target_id);
        if (voter && target) {
            htmlResult += `<div><small>${voter.name} ➡️ ${target.name}</small></div>`;
        }
    });
    document.getElementById("voteResults").innerHTML = htmlResult;
    document.getElementById("voteResults").style.display = 'block';

    // Si estoy muerto, no botones
    if (!STATE.me.alive) {
        document.getElementById("votePlayers").innerHTML = "<p>Esperando resultado...</p>";
        return;
    }

    // Si ya voté
    const miVoto = STATE.votes.find(v => v.voter_id === STATE.me.id);
    if (miVoto) {
        const target = STATE.players.find(p => p.id === miVoto.target_id);
        document.getElementById("votePlayers").innerHTML =
            `<div class="alert alert-success">Votaste a <strong>${target?.name}</strong></div>`;
    } else {
        // Botones de votación
        const targets = STATE.players.filter(p => p.alive && p.id !== STATE.me.id);
        let htmlButtons = targets.map(p =>
            `<button class="btn btn-outline-danger w-100 my-1" onclick="enviarVoto('${p.id}')">Votar a ${p.name}</button>`
        ).join("");

        if (!targets.length) htmlButtons = "<p>No hay a quién votar.</p>";
        document.getElementById("votePlayers").innerHTML = htmlButtons;
    }
}

/* ============================================
   ACCIONES
============================================ */
async function iniciarJuego() {
    console.log("Intentando iniciar juego...");
    showMessage("Iniciando...");

    // 1. Validar categorías
    const inputs = document.querySelectorAll("#injected-config input:checked");
    const seleccionadas = Array.from(inputs).map(i => i.value);

    if (seleccionadas.length === 0) {
        hideMessage();
        return alert("¡Tenés que elegir al menos una categoría!");
    }

    // 2. Elegir palabra
    let pool = [];
    seleccionadas.forEach(cat => {
        if (window.PERSONAJES[cat]) pool = pool.concat(window.PERSONAJES[cat]);
    });
    if (!pool.length) pool = ["Default"];
    const palabra = pool[Math.floor(Math.random() * pool.length)];

    // 3. Asignar roles (DB Update Players)
    const playersIds = STATE.players.map(p => p.id);
    const impostorId = playersIds[Math.floor(Math.random() * playersIds.length)];

    const updates = STATE.players.map(p => {
        return supabase.from("players").update({
            role: (p.id === impostorId) ? 'impostor' : 'player',
            alive: true
        }).eq("id", p.id);
    });

    try {
        await Promise.all(updates);
    } catch (err) {
        console.error(err);
        hideMessage();
        return alert("Error asignando roles: " + err.message);
    }

    // 4. Update Room (Start)
    const { error: roomError } = await supabase.from("rooms").update({
        started: true,
        voting: false,
        word: palabra,
        estado: null,
        resultado_texto: null
    }).eq("id", STATE.room.id);

    hideMessage();

    if (roomError) {
        console.error(roomError);
        return alert("Error iniciando partida (Room Update): " + roomError.message);
    }

    console.log("Partida iniciada OK");
}

async function iniciarVotacion() {
    await supabase.from("votes").delete().eq("room_id", STATE.room.id);
    await supabase.from("rooms").update({ voting: true, resultado_texto: null }).eq("id", STATE.room.id);
}

async function enviarVoto(targetId) {
    if (!STATE.me.alive) return;
    const { error } = await supabase.from("votes").insert({
        room_id: STATE.room.id,
        voter_id: STATE.me.id,
        target_id: targetId
    });
    if (error) alert("Error al votar: " + error.message);
}

async function checkVotacionCompletaHost() {
    // Evitar loop si ya finalizó
    if (STATE.room.estado === 'fin' || !STATE.room.voting) return;

    const vivos = STATE.players.filter(p => p.alive);
    const votos = STATE.votes;

    if (vivos.length > 0 && votos.length >= vivos.length) {
        console.log("Votación completa, procesando...");
        await procesarVotacion();
    }
}

async function procesarVotacion() {
    const conteo = {};
    STATE.votes.forEach(v => conteo[v.target_id] = (conteo[v.target_id] || 0) + 1);

    let maxVotos = -1;
    let eliminadoId = null;

    Object.keys(conteo).forEach(id => {
        if (conteo[id] > maxVotos) {
            maxVotos = conteo[id];
            eliminadoId = id;
        }
    });

    // Empate simple: muere el primero que encontró (se puede mejorar)
    if (!eliminadoId) return;

    const eliminado = STATE.players.find(p => p.id === eliminadoId);

    // Matar en DB
    await supabase.from("players").update({ alive: false }).eq("id", eliminadoId);

    // Calcular resultado
    let resultadoHTML = "";
    let nuevoEstado = "continua";

    if (eliminado.role === 'impostor') {
        resultadoHTML = `<div class="alert alert-success"><h1>🎉 CIUDADANOS GANAN</h1><p>El impostor era <b>${eliminado.name}</b></p></div>`;
        nuevoEstado = "fin";
    } else {
        // Verificar si Impostor gana (quedan 2 vivos: 1 imp, 1 player)
        // Restamos 1 porque acabamos de eliminar a un inocente
        const vivosRestantes = STATE.players.filter(p => p.alive && p.id !== eliminadoId).length;

        if (vivosRestantes <= 2) {
            const imp = STATE.players.find(p => p.role === 'impostor');
            resultadoHTML = `<div class="alert alert-danger"><h1>🔪 IMPOSTOR GANA</h1><p>Quedan pocos vivos. Impostor: <b>${imp?.name}</b></p></div>`;
            nuevoEstado = "fin";
        } else {
            resultadoHTML = `<div class="alert alert-warning"><h3>🚫 ${eliminado.name} eliminado</h3><p>Era inocente.</p></div>`;
        }
    }

    await supabase.from("rooms").update({
        voting: false,
        estado: nuevoEstado,
        resultado_texto: resultadoHTML
    }).eq("id", STATE.room.id);
}

async function nuevaRonda() {
    showMessage("Reiniciando...");
    await supabase.from("votes").delete().eq("room_id", STATE.room.id);
    await supabase.from("players").update({ alive: true, role: null }).eq("room_id", STATE.room.id);
    await supabase.from("rooms").update({
        started: false,
        voting: false,
        word: null,
        estado: null,
        resultado_texto: null
    }).eq("id", STATE.room.id);
    hideMessage();
}