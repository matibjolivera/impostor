/* ============================================
   CONFIG SUPABASE
   ============================================ */
const SUPABASE_URL = window.SUPABASE_URL;
const SUPABASE_KEY = window.SUPABASE_KEY;

const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

/* VARIABLES */
let ROOM_ID = null;
let ROOM_CODE = null;
let PLAYER_ID = null;
let IS_HOST = false;

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
            impostors_count: 1
        })
        .select()
        .single();

    ROOM_ID = room.id;
    ROOM_CODE = room.code;
    IS_HOST = true;

    let hostName = prompt("Ingresá tu nombre (host):");

    let {data: player} = await supabase
        .from("players")
        .insert({
            room_id: ROOM_ID,
            name: hostName
        })
        .select()
        .single();

    PLAYER_ID = player.id;

    mostrarConfigSala();
}

/* ============================================
   MOSTRAR CONFIGURACIÓN INICIAL DEL HOST
   ============================================ */
function mostrarConfigSala() {
    document.getElementById("stepHostConfig").style.display = "block";

    // cargar categorías
    const div = document.getElementById("categorias");
    div.innerHTML = "";

    Object.keys(window.PERSONAJES).forEach(cat => {
        div.innerHTML += `
      <label>
        <input type="checkbox" value="${cat}">
        ${cat}
      </label><br>`;
    });
}

/* ============================================
   UNIRSE A SALA COMO JUGADOR
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
            name
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

    escucharJugadores();
    escucharPartida();
}

/* ============================================
   ESCUCHAR JUGADORES EN VIVO
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
        .eq("room_id", ROOM_ID);

    document.getElementById("playersList").innerHTML =
        players.map(p => p.name).join("<br>");
}

/* ============================================
   INICIAR JUEGO (HOST)
   ============================================ */
async function iniciarJuego() {
    if (!IS_HOST) return;

    // leer categorías seleccionadas
    const seleccionadas = [...document.querySelectorAll("#categorias input:checked")].map(i => i.value);
    if (seleccionadas.length === 0) {
        alert("Seleccioná al menos una categoría");
        return;
    }

    // juntar palabras de categorías
    let pool = [];
    seleccionadas.forEach(cat => {
        pool = pool.concat(window.PERSONAJES[cat]);
    });

    const impostorsCount = parseInt(document.getElementById("impostoresCount").value, 10);

    let {data: players} = await supabase
        .from("players")
        .select("*")
        .eq("room_id", ROOM_ID);

    // elegir palabra
    const palabra = pool[Math.floor(Math.random() * pool.length)];

    // elegir impostores
    let impostores = [];
    let copy = [...players];

    for (let i = 0; i < impostorsCount; i++) {
        const idx = Math.floor(Math.random() * copy.length);
        impostores.push(copy[idx].id);
        copy.splice(idx, 1);
    }

    // actualizar roles en DB
    for (let p of players) {
        await supabase
            .from("players")
            .update({
                role: impostores.includes(p.id) ? "impostor" : "player"
            })
            .eq("id", p.id);
    }

    // actualizar room
    await supabase
        .from("rooms")
        .update({
            started: true,
            word: palabra,
            impostors_count: impostorsCount
        })
        .eq("id", ROOM_ID);
}

/* ============================================
   ESCUCHAR CAMBIOS DE PARTIDA
   ============================================ */
function escucharPartida() {
    supabase
        .channel("room_status_" + ROOM_ID)
        .on(
            "postgres_changes",
            {event: "*", schema: "public", table: "rooms", filter: "id=eq." + ROOM_ID},
            mostrarRol
        )
        .subscribe();
}

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

    if (IS_HOST) {
        document.getElementById("hostControls").style.display = "none";
        document.getElementById("stepHostConfig").style.display = "none";
        document.getElementById("newRoundControls").style.display = "block";
    }

    if (me.role === "impostor") {
        document.getElementById("yourRole").innerHTML = "🚨 SOS EL IMPOSTOR 🚨";
    } else {
        document.getElementById("yourRole").innerHTML = "Tu palabra: " + room.word;
    }

}

async function nuevaRonda() {

    // mostrar controles solo al host
    if (!IS_HOST) return;

    // volver a mostrar controles de config
    document.getElementById("stepHostConfig").style.display = "block";
    document.getElementById("hostControls").style.display = "block";
    document.getElementById("newRoundControls").style.display = "none";

    // resetear room
    await supabase
        .from("rooms")
        .update({
            started: false,
            word: null
        })
        .eq("id", ROOM_ID);

    // resetear roles de jugadores
    await supabase
        .from("players")
        .update({role: null})
        .eq("room_id", ROOM_ID);

    // limpiar el resultado mostrado
    document.getElementById("yourRole").innerHTML = "";
}
