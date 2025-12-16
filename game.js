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

// RUTAS (IDs HTML)
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

    if (error) return alert("Error DB: " + error.message);

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

    if (pError) return alert("Error Player: " + pError.message);

    iniciarSesionLocal(room, player);
}

async function unirseSala() {
    const code = document.getElementById("join_code").value;
    const name = document.getElementById("join_name").value;

    if (!code || !name) return alert("Faltan datos");

    const { data: room, error } = await supabase
        .from("rooms")
        .select("*")
        .eq("code", code)
        .single();

    if (error || !room) return alert("Sala no encontrada.");

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
    STATE.isHost = (room.created_at === player.created_at) || true;
    setupRealtime();
    sincronizarEstado();
}

/* ============================================
   REALTIME
============================================ */
function setupRealtime() {
    if (!STATE.room) return;
    const channel = supabase.channel(`game_${STATE.room.id}`);

    // Escuchar Room
    channel.on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'rooms', filter: `id=eq.${STATE.room.id}` },
        () => sincronizarEstado()
    );

    // Escuchar Players y Votes
    ['players', 'votes'].forEach(table => {
        channel.on(
            'postgres_changes',
            { event: '*', schema: 'public', table: table, filter: `room_id=eq.${STATE.room.id}` },
            () => sincronizarEstado()
        );
    });

    channel.subscribe();
}

async function sincronizarEstado() {
    if (!STATE.room?.id) return;

    const [rRes, pRes, vRes] = await Promise.all([
        supabase.from("rooms").select("*").eq("id", STATE.room.id).single(),
        supabase.from("players").select("*").eq("room_id", STATE.room.id).order('created_at', {ascending: true}),
        supabase.from("votes").select("*").eq("room_id", STATE.room.id)
    ]);

    if (rRes.data) STATE.room = rRes.data;
    if (pRes.data) STATE.players = pRes.data;
    if (vRes.data) STATE.votes = vRes.data;

    const updatedMe = STATE.players.find(p => p.id === STATE.me.id);
    if (updatedMe) STATE.me = updatedMe;

    if (STATE.players.length > 0) {
        STATE.isHost = (STATE.me.id === STATE.players[0].id);
    }

    renderUI();

    // Check Host Automático
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

    // Render Lista Jugadores
    const listHtml = STATE.players.map(p => {
        let status = p.alive ? "🙂" : "💀";
        let roleInfo = (!p.alive && p.role === 'impostor') ? " (IMPOSTOR)" : "";
        let meTag = (p.id === STATE.me.id) ? " <b>(Vos)</b>" : "";
        let hostTag = (STATE.players[0]?.id === p.id) ? " 👑" : "";
        let style = p.alive ? "" : "text-decoration: line-through; color: #888;";
        return `<div style="${style}">${status} ${p.name}${roleInfo} ${meTag} ${hostTag}</div>`;
    }).join("");
    document.getElementById("playersList").innerHTML = listHtml;

    // Resetear visibilidad (Ocultar todo primero)
    const els = {
        hostControls: document.getElementById("hostControls"),
        startVoteControls: document.getElementById("startVoteControls"),
        newRoundControls: document.getElementById("newRoundControls"),
        yourRole: document.getElementById("yourRole"),
        voteArea: document.getElementById("voteArea"),
        voteResults: document.getElementById("voteResults"),
        eliminatedScreen: document.getElementById("eliminatedScreen")
    };
    Object.values(els).forEach(el => el && (el.style.display = 'none'));

    // --- 1. JUGADOR MUERTO ---
    if (!STATE.me.alive) {
        els.eliminatedScreen.style.display = 'block';
        els.eliminatedScreen.innerHTML = "<h3>💀 ESTÁS MUERTO</h3><p>Shhh... esperá el final.</p>";
    }

    // --- 2. LOBBY (ESPERA) ---
    if (!STATE.room.started) {
        els.yourRole.innerHTML = "<h4>Esperando al anfitrión...</h4>";
        els.yourRole.style.display = 'block';
        if (STATE.isHost) {
            els.hostControls.style.display = 'block';
            injectHostConfig();
        }
        return;
    }

    // --- 3. PANTALLA DE RESULTADOS ---
    if (STATE.room.resultado_texto && STATE.room.estado !== null) {
        els.voteResults.innerHTML = STATE.room.resultado_texto;
        els.voteResults.style.display = 'block';

        if (STATE.isHost) {
            els.newRoundControls.style.display = 'block';
            const btn = els.newRoundControls.querySelector("button");

            // Limpiar botón extra si existe (para evitar duplicados visuales)
            const existingExtra = document.getElementById("btn-continue");
            if (existingExtra) existingExtra.style.display = 'none';

            if (STATE.room.estado === 'fin') {
                btn.innerHTML = "🔄 NUEVA PARTIDA (Reset Total)";
                btn.className = "btn btn-success w-100";
                btn.onclick = nuevaRonda;
            } else {
                btn.innerHTML = "⚠️ REINICIAR DE CERO";
                btn.className = "btn btn-secondary w-100 mt-2";
                btn.onclick = nuevaRonda;

                // Mostrar botón continuar
                if (existingExtra) {
                    existingExtra.style.display = 'block';
                } else {
                    injectContinueButton(els.newRoundControls);
                }
            }
        } else {
            if (STATE.room.estado === 'continua') {
                els.voteResults.innerHTML += "<p class='mt-2 text-muted'>Esperando al Host...</p>";
            }
        }
        return;
    }

    // --- 4. VOTACIÓN EN CURSO ---
    if (STATE.room.voting) {
        renderPanelVotacion(els);
        return;
    }

    // --- 5. JUEGO ACTIVO (ROLES) ---
    if (STATE.me.alive) {
        els.yourRole.style.display = 'block';
        if (STATE.me.role === 'impostor') {
            els.yourRole.innerHTML = `<div class="alert alert-danger fs-2">🤫 SOS EL IMPOSTOR</div>`;
        } else {
            els.yourRole.innerHTML = `<div class="alert alert-info fs-4">Tu palabra:<br><strong>${STATE.room.word}</strong></div>`;
        }

        if (STATE.isHost) {
            els.startVoteControls.style.display = 'block';
        }
    }
}

// FIX: Verificar existencia antes de inyectar para evitar duplicados
function injectHostConfig() {
    const container = document.getElementById("hostControls");
    if (!container || document.getElementById("injected-config")) return;

    const wrapper = document.createElement("div");
    wrapper.id = "injected-config";
    wrapper.className = "mb-3 p-3 bg-white text-dark rounded border text-start";
    wrapper.innerHTML = "<h5>⚙️ Configuración:</h5>";

    if (window.PERSONAJES) {
        Object.keys(window.PERSONAJES).forEach(cat => {
            wrapper.innerHTML += `
                <div class="form-check">
                  <input class="form-check-input" type="checkbox" value="${cat}" id="cat_${cat}" checked>
                  <label class="form-check-label" for="cat_${cat}">${cat}</label>
                </div>`;
        });
    }
    container.insertBefore(wrapper, container.firstChild);
}

// FIX: Verificar existencia antes de crear botón continuar
function injectContinueButton(container) {
    if (document.getElementById("btn-continue")) return; // Ya existe, no crear otro

    const btn = document.createElement("button");
    btn.id = "btn-continue";
    btn.className = "btn btn-primary w-100 mb-2";
    btn.innerHTML = "▶️ CONTINUAR JUGANDO";
    btn.onclick = continuarJugando;
    container.insertBefore(btn, container.firstChild);
}

function renderPanelVotacion(els) {
    els.voteArea.style.display = 'block';
    const countVotos = STATE.votes.length;
    const countVivos = STATE.players.filter(p => p.alive).length;

    document.getElementById("quienFaltaBox").innerHTML = `Votos: ${countVotos} / ${countVivos}`;
    document.getElementById("quienFaltaBox").style.display = 'block';

    let htmlResult = "<h4>Votos emitidos:</h4>";
    STATE.votes.forEach(v => {
        const voter = STATE.players.find(p => p.id === v.voter_id);
        const target = STATE.players.find(p => p.id === v.target_id);
        if (voter && target) htmlResult += `<div><small>${voter.name} ➡️ ${target.name}</small></div>`;
    });
    document.getElementById("voteResults").innerHTML = htmlResult;
    document.getElementById("voteResults").style.display = 'block';

    if (!STATE.me.alive) {
        document.getElementById("votePlayers").innerHTML = "<p>Esperando resultado...</p>";
        return;
    }

    const miVoto = STATE.votes.find(v => v.voter_id === STATE.me.id);
    if (miVoto) {
        const target = STATE.players.find(p => p.id === miVoto.target_id);
        document.getElementById("votePlayers").innerHTML =
            `<div class="alert alert-success">Votaste a <strong>${target?.name}</strong></div>`;
    } else {
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
    showMessage("Iniciando...");
    const inputs = document.querySelectorAll("#injected-config input:checked");
    const seleccionadas = Array.from(inputs).map(i => i.value);

    if (!seleccionadas.length) {
        hideMessage();
        return alert("¡Elegí una categoría!");
    }

    let pool = [];
    seleccionadas.forEach(cat => window.PERSONAJES[cat] && (pool = pool.concat(window.PERSONAJES[cat])));
    if (!pool.length) pool = ["Default"];
    const palabra = pool[Math.floor(Math.random() * pool.length)];

    const ids = STATE.players.map(p => p.id);
    const impostorId = ids[Math.floor(Math.random() * ids.length)];

    const updates = STATE.players.map(p =>
        supabase.from("players").update({
            role: (p.id === impostorId) ? 'impostor' : 'player',
            alive: true
        }).eq("id", p.id)
    );
    await Promise.all(updates);

    await supabase.from("rooms").update({
        started: true,
        voting: false,
        word: palabra,
        estado: null,
        resultado_texto: null
    }).eq("id", STATE.room.id);
    hideMessage();
}

async function iniciarVotacion() {
    // FIX: Limpiar localmente primero para evitar parpadeos
    STATE.votes = [];
    await supabase.from("votes").delete().eq("room_id", STATE.room.id);
    await supabase.from("rooms").update({ voting: true, resultado_texto: null }).eq("id", STATE.room.id);
}

async function enviarVoto(targetId) {
    if (!STATE.me.alive) return;
    await supabase.from("votes").insert({
        room_id: STATE.room.id,
        voter_id: STATE.me.id,
        target_id: targetId
    });
}

// CHECK VOTACIÓN FINAL
async function checkVotacionCompletaHost() {
    if (STATE.room.estado === 'fin' || !STATE.room.voting) return;

    const vivos = STATE.players.filter(p => p.alive);
    const votos = STATE.votes;

    // FIX: Asegurar que haya al menos 1 voto para no disparar con arrays vacíos tras reset
    if (vivos.length > 0 && votos.length >= vivos.length && votos.length > 0) {
        await procesarVotacion();
    }
}

async function procesarVotacion() {
    const conteo = {};
    STATE.votes.forEach(v => conteo[v.target_id] = (conteo[v.target_id] || 0) + 1);

    let maxVotos = -1;
    let eliminadoId = null;
    Object.keys(conteo).forEach(id => {
        if (conteo[id] > maxVotos) { maxVotos = conteo[id]; eliminadoId = id; }
    });

    if (!eliminadoId) return;

    const eliminado = STATE.players.find(p => p.id === eliminadoId);
    await supabase.from("players").update({ alive: false }).eq("id", eliminadoId);

    // Lógica Ganador V5 Fix
    const sobrevivientes = STATE.players.filter(p => p.alive && p.id !== eliminadoId);
    const cantImpostores = sobrevivientes.filter(p => p.role === 'impostor').length;
    const cantCiudadanos = sobrevivientes.filter(p => p.role === 'player').length;

    let html = "";
    let nuevoEstado = "continua";

    if (eliminado.role === 'impostor' && cantImpostores === 0) {
        html = `<div class="alert alert-success"><h1>🎉 GANARON LOS CIUDADANOS</h1><p>El impostor era <b>${eliminado.name}</b></p></div>`;
        nuevoEstado = "fin";
    } else if (cantImpostores >= cantCiudadanos) {
        const imp = sobrevivientes.find(p => p.role === 'impostor');
        html = `<div class="alert alert-danger"><h1>🔪 GANÓ EL IMPOSTOR</h1><p>Victoria para <b>${imp?.name || "???"}</b></p></div>`;
        nuevoEstado = "fin";
    } else {
        html = `<div class="alert alert-warning"><h3>🚫 Eliminado: ${eliminado.name}</h3><p>Era ${eliminado.role === 'impostor' ? 'Impostor' : 'Inocente'}.</p></div>`;
    }

    await supabase.from("rooms").update({
        voting: false,
        estado: nuevoEstado,
        resultado_texto: html
    }).eq("id", STATE.room.id);
}

// --- ACCIONES DE REINICIO ---

async function nuevaRonda() {
    showMessage("Reiniciando partida...");

    // FIX CRÍTICO: Limpiar memoria local INSTANTÁNEAMENTE para que el checkVotacion no lea basura
    STATE.votes = [];
    STATE.room.voting = false;

    // 1. Borrar votos en DB
    await supabase.from("votes").delete().eq("room_id", STATE.room.id);

    // 2. Revivir jugadores
    await supabase.from("players").update({ alive: true, role: null }).eq("room_id", STATE.room.id);

    // 3. Resetear Sala (Esto dispara el cambio de vista a Lobby)
    await supabase.from("rooms").update({
        started: false,
        voting: false,
        word: null,
        estado: null,
        resultado_texto: null
    }).eq("id", STATE.room.id);

    hideMessage();
}

async function continuarJugando() {
    showMessage("Siguiente turno...");

    // FIX: Limpieza local preventiva
    STATE.votes = [];

    await supabase.from("votes").delete().eq("room_id", STATE.room.id);
    await supabase.from("rooms").update({
        voting: false,
        estado: null,
        resultado_texto: null
    }).eq("id", STATE.room.id);

    hideMessage();
}