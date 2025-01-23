const RED = "#8C205C";
const GREEN = "#0E7373";
const PROGRESS_VARIATION = 5;
const TOLERANCE_TIME = 2000;
const WIDTH = 640;
const HEIGHT = 480;

let video = document.getElementById("video");
let canvas = document.getElementById("canvas");
let ctx = canvas.getContext("2d");
let gameStatus = document.getElementById("gameStatus");
let toggleGameButton = document.getElementById("toggleGame");
let cameraSelect = document.getElementById("cameraSelect");
//let song = document.getElementById("song");
let timerDisplay = document.getElementById("timer");
let progressDisplay = document.getElementById("progress");
let body = document.body;

let isGameActive = false;
let isPaused = false;
let lastHeadPosition = null;
let movementThreshold = 10;
let detectionInterval = 300;
let gameDuration = 60;
let timerInterval;
let poseNetModel;
let selectedCameraId = null;
let toleranceTimeout;
let progressValue = 0;

let pauseSchedule = []; // Lista con los momentos de pausa y sus duraciones

/**
 * @function getCameras
 * @description Obtiene las cámaras disponibles y las muestra en un select.
 */
async function getCameras() {
	const devices = await navigator.mediaDevices.enumerateDevices();
	const videoDevices = devices.filter((device) => device.kind === "videoinput");

	cameraSelect.innerHTML = "";
	videoDevices.forEach((device, index) => {
		let option = document.createElement("option");
		option.value = device.deviceId;
		option.text = device.label || `Cámara ${index + 1}`;
		cameraSelect.appendChild(option);
	});

	if (videoDevices.length > 0) {
		selectedCameraId = videoDevices[0].deviceId;
		cameraSelect.value = selectedCameraId;
		setupCamera(selectedCameraId);
	}
}

cameraSelect.addEventListener("change", () => {
	selectedCameraId = cameraSelect.value;
	setupCamera(selectedCameraId);
});

/**
 * @function setupCamera
 * @param deviceId Cámara seleccionada.
 * @description Inicializa la cámara con las dimensiones y el dispositivo seleccionado.
 */
async function setupCamera(deviceId) {
	const constraints = {
		video: {
			width: WIDTH,
			height: HEIGHT,
			deviceId: deviceId ? { exact: deviceId } : undefined,
		},
	};

	const stream = await navigator.mediaDevices.getUserMedia(constraints);
	video.srcObject = stream;

	video.onloadeddata = () => {
		canvas.width = video.videoWidth;
		canvas.height = video.videoHeight;
		video.play();
	};
}

/**
 * @function setProgress
 * @param value Valor de progreso.
 * @description Actualiza el valor de progreso y lo muestra en pantalla.
 */
function setProgress(value) {
	progressValue = value;
	progressDisplay.value = value;
}

/**
 * @function loadPoseNet
 * @description Carga el modelo de PoseNet.
 */
async function loadPoseNet() {
	poseNetModel = await posenet.load({
		architecture: "MobileNetV1",
		outputStride: 16,
		inputResolution: { width: WIDTH, height: HEIGHT },
		multiplier: 0.75,
	});
}

/**
 * @function validateHeadPresence
 * @description
 * Verifica si la cabeza del usuario ha sido detectada antes de iniciar el juego.
 * @returns {Promise<boolean>} True si la cabeza es detectada, False si no.
 */
async function validateHeadPresence() {
	ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

	const pose = await poseNetModel.estimateSinglePose(canvas, {
		flipHorizontal: false,
		minPoseConfidence: 0.12,
		minPartConfidence: 0.1,
	});

	let headPosition = getHeadPosition(pose.keypoints);

	if (!headPosition) {
		gameStatus.innerText = "No se ha detectado tu rostro.";
		return false;
	}

	return true;
}

/**
 * @function getHeadPosition
 * @description Obtiene la posición promedio de la cabeza a partir de los puntos clave detectados.
 * @param keypoints Puntos clave detectados por PoseNet.
 * @returns {x, y} Posición promedio de la cabeza.
 */
function getHeadPosition(keypoints) {
	let headParts = ["nose", "leftEye", "rightEye"];
	let positions = keypoints
		.filter((point) => headParts.includes(point.part) && point.score > 0.1)
		.map((point) => ({ x: point.position.x, y: point.position.y }));

	if (positions.length === 0) return null;

	let sumX = positions.reduce((acc, pos) => acc + pos.x, 0);
	let sumY = positions.reduce((acc, pos) => acc + pos.y, 0);
	return { x: sumX / positions.length, y: sumY / positions.length };
}

/**
 * @function detectMovement
 * @description Detecta el movimiento de la cabeza
 * - Si el juego está pausado, detecta cualquier movimiento y termina el juego.
 * - Si el juego está en curso, detecta el movimiento y actualiza el progreso.
 * - Se llama a sí misma cada cierto intervalo de tiempo.
 */
async function detectMovement() {
	if (!isGameActive) return;

	ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

	const pose = await poseNetModel.estimateSinglePose(canvas, {
		flipHorizontal: false,
		minPoseConfidence: 0.3,
		minPartConfidence: 0.1,
	});

	let currentHeadPosition = getHeadPosition(pose.keypoints);

	if (isGameActive) {
		drawPose(pose);
	} else {
		ctx.clearRect(0, 0, canvas.width, canvas.height);
	}

	if (!currentHeadPosition) {
		setTimeout(() => detectMovement(), detectionInterval);
		return;
	}

	if (isPaused) {
		let dx = Math.abs(currentHeadPosition.x - lastHeadPosition.x);
		let dy = Math.abs(currentHeadPosition.y - lastHeadPosition.y);
		if (dx > movementThreshold || dy > movementThreshold) {
			gameOver();
			return;
		}
	} else {
		if (!lastHeadPosition) {
			lastHeadPosition = currentHeadPosition;
		}
		let dx = Math.abs(currentHeadPosition.x - lastHeadPosition.x);
		let dy = Math.abs(currentHeadPosition.y - lastHeadPosition.y);
		if (dx > movementThreshold || dy > movementThreshold) {
			setProgress(progressValue + PROGRESS_VARIATION);
			console.log("progresa");
		}
	}

	lastHeadPosition = currentHeadPosition;
	setTimeout(() => detectMovement(), detectionInterval);
}

/**
 * @function drawPose
 * @param pose Puntos clave detectados por PoseNet.
 * @description Dibuja los puntos clave en el canvas.
 */
function drawPose(pose) {
	ctx.clearRect(0, 0, canvas.width, canvas.height);
	pose.keypoints.forEach((point) => {
		if (point.score > 0.1) {
			ctx.beginPath();
			ctx.arc(point.position.x, point.position.y, 5, 0, 2 * Math.PI);
			ctx.fillStyle = isPaused ? RED : GREEN;
			ctx.fill();
		}
	});
}

/**
 * @function generatePauseSchedule
 * @description
 * - Genera la lista de pausas desde el principio.
 * - Cada pausa tiene un tiempo de inicio y duración.
 */
function generatePauseSchedule() {
	pauseSchedule = [];
	let currentTime = 5; // Inicia desde el segundo 5 (para evitar una pausa al inicio)

	while (currentTime + 10 < gameDuration) {
		// Asegurar que quede espacio para pausas
		let pauseDuration = Math.floor(Math.random() * 4) + 2; // Entre 2 y 5 segundos
		pauseSchedule.push({ start: currentTime, duration: pauseDuration });

		currentTime += pauseDuration + 5; // Mínimo 5 segundos entre pausas
	}

	console.log("Pausas programadas:", pauseSchedule);
}

/**
 * @function startGame
 * @description Inicia el juego.
 * - Verifica si la cabeza del usuario está presente.
 * - Inicia el contador y la detección de movimiento.
 * - Genera las pausas antes de iniciar el contador.
 * - Actualiza el estado del juego y el fondo.
 * - Muestra el mensaje de inicio.
 * - Deshabilita el botón de inicio.
 * - Inicia la música de fondo.
 * - Verifica si es momento de una pausa.
 * - Verifica si el juego ha terminado.
 */
async function startGame() {
	let isHeadDetected = await validateHeadPresence();
	if (!isHeadDetected) return;

	isGameActive = true;
	isPaused = false;
	lastHeadPosition = null;
	toggleGameButton.disabled = true;
	body.style.backgroundColor = GREEN; // Fondo verde al iniciar
	//song.play();
	gameStatus.innerText = "¡El juego ha comenzado!";
	timerDisplay.innerText = gameDuration;

	generatePauseSchedule(); // Se generan las pausas antes de iniciar el contador

	let timeLeft = gameDuration;
	timerInterval = setInterval(() => {
		timeLeft--;
		timerDisplay.innerText = timeLeft;

		// Verificar si es momento de una pausa
		let currentPause = pauseSchedule.find((pause) => pause.start === timeLeft);
		if (currentPause) {
			pauseGame(currentPause.duration);
		}

		if (progressValue >= 100) {
			gameWin();
		}

		if (timeLeft <= 0) {
			clearInterval(timerInterval);
			gameOver();
			//gameWin();
		}
	}, 1000);

	detectMovement();
}

/**
 * @function pauseGame
 * @param duration Duración de la pausa.
 * @description Pausa el juego por la duración especificada.
 */
function pauseGame(duration) {
	gameStatus.innerText = "¡Alto!";
	body.style.backgroundColor = RED; // Fondo rojo al pausar
	//song.pause();
	console.log(`⏸️ Pausa por ${duration} segundos`);

	setTimeout(() => {
		console.log("⏳ Tolerancia terminada, ahora se detecta el movimiento.");
		gameStatus.innerText = "¡No te muevas!";
		isPaused = true;
		setTimeout(() => {
			if (isGameActive) {
				resumeGame();
			}
		}, duration * 1000);
	}, TOLERANCE_TIME);
}

/**
 * @function resumeGame
 * @description
 * Reanuda el juego después de una pausa.
 */
function resumeGame() {
	isPaused = false;
	toleranceTimeout = null;
	gameStatus.innerText = "¡Continúa!";
	body.style.backgroundColor = GREEN; // Volver a verde al reanudar
	//song.play();
}

/**
 * @function gameOver
 * @description Finaliza el juego.
 */
function gameOver() {
	resetGame();
	ctx.clearRect(0, 0, canvas.width, canvas.height);
	gameStatus.innerText = "¡Game Over!";
	// timerDisplay.innerText = "😢";
}

/**
 * @function gameWin
 * @description Gana el juego.
 */
function gameWin() {
	resetGame();
	ctx.clearRect(0, 0, canvas.width, canvas.height);
	gameStatus.innerText = "¡Ganaste! 🎉";
	timerDisplay.innerText = "🏆";
}

/**
 * @function resetGame
 * @description Reinicia el juego.
 */
function resetGame() {
	isGameActive = false;
	//song.pause();
	progressValue = 0;
	toggleGameButton.disabled = false;
	body.style.backgroundColor = "black"; // Fondo negro al terminar
	gameStatus.innerText = "Fin";
	clearInterval(timerInterval);
}

getCameras();
toggleGameButton.addEventListener("click", async () => {
	if (!poseNetModel) await loadPoseNet();
	startGame();
});
