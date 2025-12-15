/* ============================================
   CONFIG SUPABASE & GLOBALES
============================================ */
const SUPABASE_URL = window.SUPABASE_URL;
const SUPABASE_KEY = window.SUPABASE_KEY;
const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// ESTADO LOCAL (Single Source of Truth)
let STATE = {
    room: null,
    me: null,
    players: [],
    votes: [],
    isHost: false
};

// AYUDAS DE NAVEGACIÓN
const ROUTES = {
    CREATE: 'stepCreate',
    JOIN: 'stepJoin',
    GAME: 'stepGame'
    // stepHostConfig lo ignoramos, lo inyectaremos dinámicamente
};

/* ============================================
   UI HELPERS GENÉRICOS
============================================ */
function showView(viewId) {
    // Ocultar todas las vistas principales
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
   LÓGICA DE INICIO (CREAR / UNIRSE)
============================================ */

// 1. CREAR SALA
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

    if (error) return alert("Error al crear sala: " + error.message);

    // Crear Host Player
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

    if (pError) return alert("Error al crear jugador: " + pError.message);

    iniciarSesionLocal(room, player);
}

// 2. UNIRSE A SALA
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

    if (error || !room) return alert("Sala no encontrada");

    // Crear Player
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

// 3. SESIÓN LOCAL Y REALTIME
function iniciarSesionLocal(room, player) {
    STATE.room = room;
    STATE.me = player;
    // Cálculo inicial de host (si creó la sala es host seguro)
    STATE.isHost = (room.created_at === player.created_at) || true;

    setupRealtime();
    sincronizarEstado();
}

/* ============================================
   CORE: REALTIME & SINCRONIZACIÓN
============================================ */
function setupRealtime() {
    if (!STATE.room) return;

    const channel = supabase.channel(`game_${STATE.room.id}`);
    const tables = ['rooms', 'players', 'votes'];

    tables.forEach(table => {
        channel.on(
            'postgres_changes',
            { event: '*', schema: 'public', table: table, filter: `room_id=eq.${STATE.room.id}` },
            (payload) => {
                console.log(`Cambio en ${table}`, payload);
                sincronizarEstado();
            }
        );
    });

    // Listener extra específico para updates de la room misma
    channel.on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'rooms', filter: `id=eq.${STATE.room.id}` },
        () => sincronizarEstado()
    );

    channel.subscribe();
}

async function sincronizarEstado() {
    if (!STATE.room?.id) return;

    // Fetch paralelo para velocidad
    const [roomRes, playersRes, votesRes] = await Promise.all([
        supabase.from("rooms").select("*").eq("id", STATE.room.id).single(),
        supabase.from("players").select("*").eq("room_id", STATE.room.id).order('created_at'),
        supabase.from("votes").select("*").eq("room_id", STATE.room.id)
    ]);

    if (roomRes.data) STATE.room = roomRes.data;
    if (playersRes.data) STATE.players = playersRes.data;
    STATE.votes = votesRes.data || [];

    // Actualizar referencia de "ME"
    const updatedMe = STATE.players.find(p => p.id === STATE.me.id);
    if (updatedMe) STATE.me = updatedMe;

    // Determinar Host (el más antiguo de la sala)
    if (STATE.players.length > 0) {
        const oldest = STATE.players.reduce((prev, curr) =>
            (new Date(curr.created_at) < new Date(prev.created_at) ? curr : prev)
        );
        STATE.isHost = (STATE.me.id === oldest.id);
    }

    renderUI();

    // Check automático de fin de votación (Solo host)
    if (STATE.isHost && STATE.room.voting) {
        checkVotacionCompletaHost();
    }
}

/* ============================================
   RENDER UI (LA MÁQUINA DE ESTADOS)
============================================ */
function renderUI() {
    showView(ROUTES.GAME);

    // Header
    document.getElementById("room_code_display").innerText = `Sala: ${STATE.room.code}`;

    // Lista de Jugadores con indicadores
    const listHtml = STATE.players.map(p => {
        let status = p.alive ? "😊" : "💀";
        let meTag = (p.id === STATE.me.id) ? " (Vos)" : "";
        let hostTag = (STATE.players[0]?.id === p.id) ? "👑" : "";

        // Estilo visual si está muerto
        let style = p.alive ? "" : "text-decoration: line-through; color: gray;";

        return `<div style="${style}">${status} ${p.name} ${meTag} ${hostTag}</div>`;
    }).join("");
    document.getElementById("playersList").innerHTML = listHtml;

    // Referencias a elementos del DOM
    const els = {
        hostControls: document.getElementById("hostControls"),
        startVoteControls: document.getElementById("startVoteControls"),
        newRoundControls: document.getElementById("newRoundControls"),
        yourRole: document.getElementById("yourRole"),
        voteArea: document.getElementById("voteArea"),
        voteResults: document.getElementById("voteResults"),
        eliminatedScreen: document.getElementById("eliminatedScreen")
    };

    // Resetear visibilidad (todo oculto por defecto)
    Object.values(els).forEach(el => el && (el.style.display = 'none'));

    // CASO ESPECIAL: JUGADOR MUERTO
    if (!STATE.me.alive) {
        els.eliminatedScreen.style.display = 'block';
        els.eliminatedScreen.innerHTML = "<h2>💀 ESTÁS MUERTO 💀</h2><p>Podés ver, pero no votar ni hablar.</p>";
    }

    // --- FASE 1: LOBBY (Esperando iniciar) ---
    if (!STATE.room.started) {
        els.yourRole.innerHTML = "<h3>Esperando al anfitrión...</h3>";

        if (STATE.isHost) {
            els.hostControls.style.display = 'block';
            // INYECTAR CONFIGURACIÓN AQUÍ PARA QUE EL HOST LA VEA
            injectHostConfig();
        }
        return;
    }

    // --- FASE 2: JUEGO EN CURSO ---

    // Mostrar Rol (si estás vivo)
    if (STATE.me.alive) {
        els.yourRole.style.display = 'block';
        if (STATE.me.role === 'impostor') {
            els.yourRole.innerHTML = `<div class="alert alert-danger fs-1">🤫 SOS EL IMPOSTOR</div>`;
        } else {
            els.yourRole.innerHTML = `<div class="alert alert-info fs-3">Tu palabra: <br><strong>${STATE.room.word}</strong></div>`;
        }
    } else {
        els.yourRole.innerHTML = "";
    }

    // Mostrar Resultados Globales (si existen)
    if (STATE.room.resultado_texto && STATE.room.estado !== null) {
        els.voteResults.innerHTML = STATE.room.resultado_texto;
        els.voteResults.style.display = 'block';

        if (STATE.isHost) {
            els.newRoundControls.style.display = 'block';
        }
        return;
    }

    // --- FASE 3: VOTACIÓN ---
    if (STATE.room.voting) {
        renderPanelVotacion(els);
        return;
    }

    // --- FASE 4: DISCUSIÓN (Botón iniciar votación) ---
    if (STATE.isHost && STATE.me.alive) {
        els.startVoteControls.style.display = 'block';
    }
}

// Inyecta las categorías DENTRO del panel de control del host en el Lobby
function injectHostConfig() {
    const container = document.getElementById("hostControls");
    const existingConfig = document.getElementById("injected-config");

    if (existingConfig) return; // Ya está inyectado

    const wrapper = document.createElement("div");
    wrapper.id = "injected-config";
    wrapper.className = "mb-3 p-3 bg-white text-dark rounded border";
    wrapper.style.textAlign = "left";
    wrapper.innerHTML = "<h5>⚙️ Configuración:</h5><small>Elegí categorías:</small>";

    // Generar checkboxes
    if (window.PERSONAJES) {
        Object.keys(window.PERSONAJES).forEach(cat => {
            wrapper.innerHTML += `
                <div class="form-check">
                  <input class="form-check-input" type="checkbox" value="${cat}" id="cat_${cat}" checked>
                  <label class="form-check-label" for="cat_${cat}">${cat}</label>
                </div>`;
        });
    } else {
        wrapper.innerHTML += "<p class='text-danger'>Falta archivo personajes.js</p>";
    }

    // Insertar ANTES del botón de iniciar
    const btn = container.querySelector("button");
    container.insertBefore(wrapper, btn);
}

function renderPanelVotacion(els) {
    els.voteArea.style.display = 'block';

    // Si estoy muerto, veo progreso
    if (!STATE.me.alive) {
        document.getElementById("votePlayers").innerHTML = "<p>Esperando votación...</p>";
        renderVotosParciales();
        return;
    }

    // Si ya voté
    const miVoto = STATE.votes.find(v => v.voter_id === STATE.me.id);
    if (miVoto) {
        const target = STATE.players.find(p => p.id === miVoto.target_id);
        document.getElementById("votePlayers").innerHTML = `<div class="alert alert-success">Votaste a: <strong>${target ? target.name : 'Unknown'}</strong></div>`;
        renderVotosParciales();
    } else {
        // Botones para votar
        const vivos = STATE.players.filter(p => p.alive && p.id !== STATE.me.id);
        let html = vivos.map(p =>
            `<button class="btn btn-outline-danger w-100 my-1" onclick="enviarVoto('${p.id}')">Votar a ${p.name}</button>`
        ).join("");

        if (vivos.length === 0) html = "<p class='text-muted'>Solo quedás vos (o error).</p>";

        document.getElementById("votePlayers").innerHTML = html;
        document.getElementById("votoPropioBox").style.display = 'none';
        document.getElementById("quienFaltaBox").style.display = 'none';
    }
}

function renderVotosParciales() {
    const vivosCount = STATE.players.filter(p => p.alive).length;
    const votosCount = STATE.votes.length;

    document.getElementById("quienFaltaBox").innerHTML = `Votos: ${votosCount} / ${vivosCount}`;
    document.getElementById("quienFaltaBox").style.display = 'block';

    // Lista de votos
    let htmlResult = "<h4>Votos emitidos:</h4>";
    STATE.votes.forEach(v => {
        const voter = STATE.players.find(p => p.id === v.voter_id);
        const target = STATE.players.find(p => p.id === v.target_id);
        if (voter && target) {
            htmlResult += `<div><small>${voter.name} votó a <strong>${target.name}</strong></small></div>`;
        }
    });
    document.getElementById("voteResults").innerHTML = htmlResult;
    document.getElementById("voteResults").style.display = 'block';
}

/* ============================================
   ACCIONES DEL JUEGO
============================================ */

// 1. INICIAR PARTIDA (Host)
async function iniciarJuego() {
    showMessage("Asignando roles...");

    // Buscar checkboxes dentro de nuestro contenedor inyectado
    const inputs = document.querySelectorAll("#injected-config input:checked");
    const seleccionadas = Array.from(inputs).map(i => i.value);

    if (seleccionadas.length === 0) {
        hideMessage();
        return alert("¡Seleccioná al menos una categoría!");
    }

    let pool = [];
    seleccionadas.forEach(cat => {
        if (window.PERSONAJES[cat]) pool = pool.concat(window.PERSONAJES[cat]);
    });

    // Fallback por si pool está vacío
    if (pool.length === 0) pool = ["Error: Sin palabras"];
    const palabra = pool[Math.floor(Math.random() * pool.length)];

    // Asignar roles
    const playersIds = STATE.players.map(p => p.id);
    const impostorId = playersIds[Math.floor(Math.random() * playersIds.length)];

    const updates = STATE.players.map(p => {
        return supabase.from("players").update({
            role: (p.id === impostorId) ? 'impostor' : 'player',
            alive: true
        }).eq("id", p.id);
    });

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

// 2. INICIAR VOTACIÓN
async function iniciarVotacion() {
    await supabase.from("votes").delete().eq("room_id", STATE.room.id);
    await supabase.from("rooms").update({
        voting: true,
        resultado_texto: null
    }).eq("id", STATE.room.id);
}

// 3. ENVIAR VOTO
async function enviarVoto(targetId) {
    if (!STATE.me.alive) return;
    await supabase.from("votes").insert({
        room_id: STATE.room.id,
        voter_id: STATE.me.id,
        target_id: targetId
    });
}

// 4. CHECK FINALIZAR VOTACIÓN
async function checkVotacionCompletaHost() {
    const vivos = STATE.players.filter(p => p.alive);
    const votos = STATE.votes;

    // Usamos >= para evitar bloqueos si hay lag
    if (vivos.length > 0 && votos.length >= vivos.length) {
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

    if (!eliminadoId) return;

    const eliminado = STATE.players.find(p => p.id === eliminadoId);
    await supabase.from("players").update({ alive: false }).eq("id", eliminadoId);

    let resultadoHTML = "";
    let estadoJuego = "continua";

    if (eliminado.role === 'impostor') {
        resultadoHTML = `<div class="alert alert-success">
            <h1>🎉 CIUDADANOS GANAN 🎉</h1>
            <p>El impostor <strong>${eliminado.name}</strong> ha sido eliminado.</p>
        </div>`;
        estadoJuego = "fin";
    } else {
        const vivosRestantes = STATE.players.filter(p => p.alive && p.id !== eliminadoId).length;
        if (vivosRestantes <= 2) {
             const impostor = STATE.players.find(p => p.role === 'impostor');
             resultadoHTML = `<div class="alert alert-danger">
                <h1>🔪 IMPOSTOR GANA 🔪</h1>
                <p>Impostor: <strong>${impostor ? impostor.name : '???'}</strong></p>
             </div>`;
             estadoJuego = "fin";
        } else {
            resultadoHTML = `<div class="alert alert-warning">
                <h3>🚫 ${eliminado.name} eliminado.</h3>
                <p>Era un ciudadano inocente.</p>
            </div>`;
        }
    }

    await supabase.from("rooms").update({
        voting: false,
        estado: estadoJuego,
        resultado_texto: resultadoHTML
    }).eq("id", STATE.room.id);
}

// 5. NUEVA RONDA
async function nuevaRonda() {
    showMessage("Reseteando partida...");
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