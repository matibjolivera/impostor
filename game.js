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
    votes: []
};

// AYUDAS DE NAVEGACIÓN
const ROUTES = {
    CREATE: 'stepCreate',
    JOIN: 'stepJoin',
    HOST_CONFIG: 'stepHostConfig',
    GAME: 'stepGame'
};

/* ============================================
   UI HELPERS GENÉRICOS
============================================ */
function showView(viewId) {
    [ROUTES.CREATE, ROUTES.JOIN, ROUTES.HOST_CONFIG, ROUTES.GAME].forEach(id => {
        document.getElementById(id).style.display = (id === viewId) ? 'block' : 'none';
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
    mostrarConfigHost();
}

// 2. CONFIGURACIÓN INICIAL DEL HOST
function mostrarConfigHost() {
    const div = document.getElementById("categorias");
    div.innerHTML = "";

    // Generar checkboxes desde window.PERSONAJES (definido en personajes.js)
    if (window.PERSONAJES) {
        Object.keys(window.PERSONAJES).forEach(cat => {
            div.innerHTML += `
                <div class="form-check">
                  <input class="form-check-input" type="checkbox" value="${cat}" id="cat_${cat}">
                  <label class="form-check-label" for="cat_${cat}">${cat}</label>
                </div>`;
        });
    }

    showView(ROUTES.HOST_CONFIG);
}

// 3. UNIRSE A SALA
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

// 4. SESIÓN LOCAL Y REALTIME
function iniciarSesionLocal(room, player) {
    STATE.room = room;
    STATE.me = player;

    // Guardar IDs en memoria global para facilitar acceso rápido si fuera necesario,
    // pero intentaremos usar siempre STATE.
    window.ROOM_ID = room.id;
    window.PLAYER_ID = player.id;
    window.IS_HOST = (room.created_at === player.created_at) || true; // Simplificación, mejor lógica abajo

    // Determinación estricta de host: El primer jugador creado es host, o si acabamos de crear la sala.
    // Para simplificar: el que creó la sala (crearSala) sabe que es host.
    // Los que se unen (unirseSala) no lo son.
    // Como el código original usaba variable global, la seteamos en el flujo.
    // (Nota: crearSala setea IS_HOST = true implícitamente al ejecutar lógica de host).

    // Configurar suscripciones
    setupRealtime();

    // Carga inicial de datos
    sincronizarEstado();
}

/* ============================================
   CORE: REALTIME & SINCRONIZACIÓN
============================================ */
function setupRealtime() {
    if (!STATE.room) return;

    // Un solo canal para todo (Room, Players, Votes)
    const channel = supabase.channel(`game_${STATE.room.id}`);

    const tables = ['rooms', 'players', 'votes'];

    tables.forEach(table => {
        channel.on(
            'postgres_changes',
            { event: '*', schema: 'public', table: table, filter: `room_id=eq.${STATE.room.id}` },
            (payload) => {
                // ANTE CUALQUIER CAMBIO: Recargamos todo el estado.
                // Esto previene inconsistencias y race conditions.
                console.log(`Cambio detectado en ${table}`, payload);
                sincronizarEstado();
            }
        );
    });

    // Suscripción específica para ROOM por ID (ya que el filtro room_id a veces falla en la tabla rooms misma si no se configura bien)
    channel.on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'rooms', filter: `id=eq.${STATE.room.id}` },
        () => sincronizarEstado()
    );

    channel.subscribe();
}

async function sincronizarEstado() {
    if (!STATE.room?.id) return;

    // 1. Obtener Room
    const { data: room } = await supabase.from("rooms").select("*").eq("id", STATE.room.id).single();
    // 2. Obtener Jugadores
    const { data: players } = await supabase.from("players").select("*").eq("room_id", STATE.room.id).order('created_at');
    // 3. Obtener Votos
    const { data: votes } = await supabase.from("votes").select("*").eq("room_id", STATE.room.id);

    // Actualizar Estado Global
    if (room) STATE.room = room;
    if (players) STATE.players = players;
    STATE.votes = votes || [];

    // Actualizar referencia de "ME" (por si morí o cambió mi rol)
    const updatedMe = players.find(p => p.id === STATE.me.id);
    if (updatedMe) STATE.me = updatedMe;

    // Determinar si soy HOST (el primer jugador de la lista suele ser el host)
    // O si venimos del flujo crearSala.
    // Asumiremos que el jugador más antiguo es el host para robustez.
    if (STATE.players.length > 0) {
        const oldest = STATE.players.reduce((prev, curr) =>
            (new Date(curr.created_at) < new Date(prev.created_at) ? curr : prev)
        );
        STATE.isHost = (STATE.me.id === oldest.id);
    }

    // RENDERIZAR UI
    renderUI();

    // Lógica automática del Host (Checkear fin de votación)
    if (STATE.isHost && STATE.room.voting) {
        checkVotacionCompletaHost();
    }
}

/* ============================================
   RENDER UI (LA MÁQUINA DE ESTADOS)
============================================ */
function renderUI() {
    // 1. Mostrar pantalla de juego
    showView(ROUTES.GAME);

    // Header
    document.getElementById("room_code_display").innerText = `Sala: ${STATE.room.code}`;

    // Lista de Jugadores
    const listHtml = STATE.players.map(p => {
        let status = p.alive ? "😊" : "💀";
        let meTag = (p.id === STATE.me.id) ? " (Vos)" : "";
        let hostTag = (STATE.players[0]?.id === p.id) ? "👑" : "";
        return `<div>${status} ${p.name} ${meTag} ${hostTag}</div>`;
    }).join("");
    document.getElementById("playersList").innerHTML = listHtml;

    // Resetear visibilidad de secciones críticas
    const els = {
        hostControls: document.getElementById("hostControls"),
        startVoteControls: document.getElementById("startVoteControls"),
        newRoundControls: document.getElementById("newRoundControls"),
        yourRole: document.getElementById("yourRole"),
        voteArea: document.getElementById("voteArea"),
        voteResults: document.getElementById("voteResults"),
        eliminatedScreen: document.getElementById("eliminatedScreen")
    };

    // Ocultar todo por defecto
    Object.values(els).forEach(el => el.style.display = 'none');

    // ESTADO: ELIMINADO (Overlay)
    if (!STATE.me.alive) {
        els.eliminatedScreen.style.display = 'block';
        els.eliminatedScreen.innerHTML = "<h2>💀 ESTÁS MUERTO 💀</h2><p>Podés ver, pero no votar.</p>";
        // Nota: No retornamos aquí para permitir que el jugador muerto vea los resultados
    }

    // --- FASE 1: LOBBY (Esperando iniciar) ---
    if (!STATE.room.started) {
        if (STATE.isHost) els.hostControls.style.display = 'block';
        els.yourRole.innerHTML = "<h3>Esperando al anfitrión...</h3>";
        return; // Fin del render para lobby
    }

    // --- FASE 2: PARTIDA EN CURSO ---

    // Mostrar Rol
    if (STATE.me.alive) {
        els.yourRole.style.display = 'block';
        if (STATE.me.role === 'impostor') {
            els.yourRole.innerHTML = `<div class="alert alert-danger">🤫 SOS EL IMPOSTOR</div>`;
        } else {
            els.yourRole.innerHTML = `<div class="alert alert-info">Palabra secreta: <strong>${STATE.room.word}</strong></div>`;
        }
    } else {
        els.yourRole.innerHTML = ""; // Muertos no ven rol recordatorio para no confundir
    }

    // Si hay un resultado global (Alguien murió o ganó alguien)
    if (STATE.room.resultado_texto && STATE.room.estado !== null) {
        els.voteResults.innerHTML = STATE.room.resultado_texto;
        els.voteResults.style.display = 'block';

        // Si el juego terminó o es pausa entre rondas, el host puede reiniciar
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

    // --- FASE 4: JUEGO ACTIVO (DISCUSIÓN) ---
    // Si no se está votando y no hay resultado, es momento de discutir.
    // El host puede iniciar votación.
    if (STATE.isHost && STATE.me.alive) { // Solo host vivo puede iniciar votación
        els.startVoteControls.style.display = 'block';
    }
}

function renderPanelVotacion(els) {
    els.voteArea.style.display = 'block';

    // Si estoy muerto, solo veo resultados parciales
    if (!STATE.me.alive) {
        document.getElementById("votePlayers").innerHTML = "<p>Esperando que los vivos voten...</p>";
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
        // Botones para votar (solo a vivos)
        const vivos = STATE.players.filter(p => p.alive && p.id !== STATE.me.id);
        let html = vivos.map(p =>
            `<button class="btn btn-outline-danger w-100 my-1" onclick="enviarVoto('${p.id}')">Votar a ${p.name}</button>`
        ).join("");

        if (vivos.length === 0) html = "<p>No hay a quién votar (Bug?)</p>";

        document.getElementById("votePlayers").innerHTML = html;
        document.getElementById("votoPropioBox").style.display = 'none';
        document.getElementById("quienFaltaBox").style.display = 'none';
    }
}

function renderVotosParciales() {
    const vivosCount = STATE.players.filter(p => p.alive).length;
    const votosCount = STATE.votes.length;

    // Mostrar quiénes faltan (opcional, simplificado a contador)
    const msg = `Votos: ${votosCount} / ${vivosCount}`;
    document.getElementById("quienFaltaBox").innerHTML = msg;
    document.getElementById("quienFaltaBox").style.display = 'block';

    // Mostrar lista de votos confirmados (públicos)
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

    // Lógica de palabras
    const inputs = document.querySelectorAll("#categorias input:checked");
    const seleccionadas = Array.from(inputs).map(i => i.value);

    if (seleccionadas.length === 0) {
        hideMessage();
        return alert("Seleccioná categorías primero.");
    }

    let pool = [];
    seleccionadas.forEach(cat => {
        if (window.PERSONAJES[cat]) pool = pool.concat(window.PERSONAJES[cat]);
    });

    if (pool.length === 0) pool = ["Default"];
    const palabra = pool[Math.floor(Math.random() * pool.length)];

    // Asignar roles
    const playersIds = STATE.players.map(p => p.id);
    const impostorId = playersIds[Math.floor(Math.random() * playersIds.length)];

    // Updates en paralelo
    const updates = STATE.players.map(p => {
        return supabase.from("players").update({
            role: (p.id === impostorId) ? 'impostor' : 'player',
            alive: true
        }).eq("id", p.id);
    });

    await Promise.all(updates);

    // Iniciar Room
    await supabase.from("rooms").update({
        started: true,
        voting: false,
        word: palabra,
        estado: null,
        resultado_texto: null
    }).eq("id", STATE.room.id);

    hideMessage();
}

// 2. INICIAR VOTACIÓN (Host)
async function iniciarVotacion() {
    // Limpiar votos viejos por seguridad
    await supabase.from("votes").delete().eq("room_id", STATE.room.id);

    // Activar estado voting
    await supabase.from("rooms").update({
        voting: true,
        resultado_texto: null
    }).eq("id", STATE.room.id);
}

// 3. ENVIAR VOTO (Player)
async function enviarVoto(targetId) {
    if (!STATE.me.alive) return;

    await supabase.from("votes").insert({
        room_id: STATE.room.id,
        voter_id: STATE.me.id,
        target_id: targetId
    });
    // El realtime actualizará la UI
}

// 4. CHECK FINALIZAR VOTACIÓN (Host Automático)
async function checkVotacionCompletaHost() {
    const vivos = STATE.players.filter(p => p.alive);
    const votos = STATE.votes;

    // Si todos votaron
    if (vivos.length > 0 && votos.length >= vivos.length) {
        console.log("Votación completa. Calculando resultados...");
        await procesarVotacion();
    }
}

async function procesarVotacion() {
    // Conteo
    const conteo = {};
    STATE.votes.forEach(v => {
        conteo[v.target_id] = (conteo[v.target_id] || 0) + 1;
    });

    // Encontrar el más votado
    let maxVotos = -1;
    let eliminadoId = null;

    Object.keys(conteo).forEach(id => {
        if (conteo[id] > maxVotos) {
            maxVotos = conteo[id];
            eliminadoId = id;
        }
    });

    // Verificar empate (Simplificado: si hay empate, muere el primero encontrado.
    // Idealmente podrías manejar empate, pero para estabilizar eliminamos siempre).
    if (!eliminadoId) return; // Nadie votó? Raro.

    const eliminado = STATE.players.find(p => p.id === eliminadoId);

    // Marcar muerto en DB
    await supabase.from("players").update({ alive: false }).eq("id", eliminadoId);

    // Generar Texto de Resultado
    let resultadoHTML = "";
    let estadoJuego = "continua";

    if (eliminado.role === 'impostor') {
        resultadoHTML = `<div class="alert alert-success">
            <h1>🎉 GANARON LOS CIUDADANOS 🎉</h1>
            <p>El impostor era <strong>${eliminado.name}</strong> y fue eliminado.</p>
        </div>`;
        estadoJuego = "fin";
    } else {
        // Chequear si ganan impostores (Quedan 2 vivos: 1 impostor y 1 player)
        // Restamos 1 porque acabamos de matar a un inocente
        const vivosRestantes = STATE.players.filter(p => p.alive && p.id !== eliminadoId).length;

        if (vivosRestantes <= 2) {
             const impostor = STATE.players.find(p => p.role === 'impostor'); // El impostor sigue vivo
             resultadoHTML = `<div class="alert alert-danger">
                <h1>🔪 GANÓ EL IMPOSTOR 🔪</h1>
                <p>Quedan pocos sobrevivientes. El impostor era <strong>${impostor ? impostor.name : '???'}</strong>.</p>
             </div>`;
             estadoJuego = "fin";
        } else {
            resultadoHTML = `<div class="alert alert-warning">
                <h3>🚫 ${eliminado.name} fue eliminado.</h3>
                <p>Era un ciudadano inocente.</p>
            </div>`;
        }
    }

    // Actualizar Room para mostrar resultados y cortar votación
    await supabase.from("rooms").update({
        voting: false,
        estado: estadoJuego,
        resultado_texto: resultadoHTML
    }).eq("id", STATE.room.id);
}

// 5. NUEVA RONDA (Host)
async function nuevaRonda() {
    showMessage("Reseteando partida...");

    // 1. Limpiar votos
    await supabase.from("votes").delete().eq("room_id", STATE.room.id);

    // 2. Revivir jugadores y limpiar roles (NO borrarlos)
    await supabase.from("players")
        .update({ alive: true, role: null })
        .eq("room_id", STATE.room.id);

    // 3. Resetear Room al estado Lobby
    await supabase.from("rooms").update({
        started: false,
        voting: false,
        word: null,
        estado: null,
        resultado_texto: null
    }).eq("id", STATE.room.id);

    hideMessage();
    // El realtime detectará started: false y llamará a renderUI, que mostrará el Lobby.
}