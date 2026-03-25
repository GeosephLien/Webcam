import * as THREE from "https://esm.sh/three@0.164.1";
import { OrbitControls } from "https://esm.sh/three@0.164.1/examples/jsm/controls/OrbitControls.js";
import {
  FilesetResolver,
  HandLandmarker
} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/+esm";

const startButton = document.getElementById("startButton");
const statusText = document.getElementById("statusText");
const gestureText = document.getElementById("gestureText");
const webcam = document.getElementById("webcam");
const overlay = document.getElementById("overlay");
const overlayCtx = overlay.getContext("2d");
const sceneRoot = document.getElementById("scene");
const scoreLeft = document.getElementById("scoreLeft");
const scoreRight = document.getElementById("scoreRight");
const gameMessage = document.getElementById("gameMessage");
const BALL_SCALE = 0.5;

let handLandmarker;
let animationFrameId = null;
let lastVideoTime = -1;
let webcamStream;

const players = [
  {
    id: "P1",
    side: "left",
    color: "#6ef2ff",
    score: 0,
    hand: null,
    smoothX: 0.28,
    smoothY: 0.5,
    active: false,
    pinch: 0,
    pinching: false,
    prevX: 0.28,
    prevY: 0.5,
    velocityX: 0,
    velocityY: 0
  },
  {
    id: "P2",
    side: "right",
    color: "#ff8ea1",
    score: 0,
    hand: null,
    smoothX: 0.72,
    smoothY: 0.5,
    active: false,
    pinch: 0,
    pinching: false,
    prevX: 0.72,
    prevY: 0.5,
    velocityX: 0,
    velocityY: 0
  }
];

const gameState = {
  owner: null,
  ball: {
    x: 0.5,
    y: 0.5,
    smoothX: 0.5,
    smoothY: 0.5,
    pulse: 0,
    stealCooldown: 0,
    vx: 0,
    vy: 0
  },
  lastMessage: "Once both players are ready, whoever grabs the energy orb first takes control."
};

gameState.scoreEffect = {
  active: false,
  timer: 0,
  duration: 42,
  side: "left",
  color: "rgba(110, 242, 255, 1)"
};
gameState.hadTrackedHands = false;

const threeState = initThreeScene(sceneRoot);

statusText.textContent = "Interactive module loaded. Click the button to start the camera.";

window.addEventListener("error", (event) => {
  if (!event.message) return;
  statusText.textContent = `Load failed: ${event.message}`;
});

startButton.addEventListener("click", async () => {
  startButton.disabled = true;
  startButton.textContent = "Starting...";
  document.body.classList.add("is-webcam-active");

  try {
    await ensureLandmarker();
    await setupCamera();
    resizeOverlay();
    statusText.textContent = "Two-player tracking is active.";
    startButton.textContent = "Webcam Active";
    animationLoop();
  } catch (error) {
    console.error(error);
    document.body.classList.remove("is-webcam-active");
    statusText.textContent = describeCameraError(error);
    startButton.disabled = false;
    startButton.textContent = "Restart Webcam Tracking";
  }
});

window.addEventListener("resize", () => {
  resizeOverlay();
  threeState.resize();
});

async function ensureLandmarker() {
  if (handLandmarker) return;

  statusText.textContent = "Loading hand tracking model...";
  const vision = await FilesetResolver.forVisionTasks(
    "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm"
  );

  handLandmarker = await HandLandmarker.createFromOptions(vision, {
    baseOptions: {
      modelAssetPath:
        "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task"
    },
    numHands: 2,
    runningMode: "VIDEO"
  });
}

async function setupCamera() {
  statusText.textContent = "Requesting camera permission...";
  webcamStream = await navigator.mediaDevices.getUserMedia({
    video: {
      facingMode: "user",
      width: { ideal: 1280 },
      height: { ideal: 720 }
    },
    audio: false
  });

  webcam.srcObject = webcamStream;
  await webcam.play();
}

function resizeOverlay() {
  const width = webcam.videoWidth || sceneRoot.clientWidth;
  const height = webcam.videoHeight || sceneRoot.clientHeight;
  overlay.width = width;
  overlay.height = height;
}

function animationLoop() {
  animationFrameId = requestAnimationFrame(animationLoop);

  if (!webcam.videoWidth || !handLandmarker) return;

  if (lastVideoTime !== webcam.currentTime) {
    lastVideoTime = webcam.currentTime;
    const result = handLandmarker.detectForVideo(webcam, performance.now());
    handleDetectionResult(result);
  }

  updateGameState();
  drawOverlay();
  updateThreeScene();
}

function handleDetectionResult(result) {
  const hadTrackedHands = gameState.hadTrackedHands;

  for (const player of players) {
    player.hand = null;
    player.active = false;
    player.pinch = 0;
    player.pinching = false;
  }

  const detectedHands = [];

  for (const landmarks of result.landmarks ?? []) {
    const indexTip = landmarks[8];
    const thumbTip = landmarks[4];
    const handX = 1 - indexTip.x;
    const handY = indexTip.y;
    const pinchDistance = Math.hypot(
      indexTip.x - thumbTip.x,
      indexTip.y - thumbTip.y,
      (indexTip.z ?? 0) - (thumbTip.z ?? 0)
    );
    const pinch = THREE.MathUtils.clamp(1 - pinchDistance * 8, 0, 1);

    detectedHands.push({ x: handX, y: handY, landmarks, pinch });
  }

  const remainingHands = [...detectedHands];
  if (!hadTrackedHands) {
    remainingHands.sort((a, b) => a.x - b.x);

    for (const hand of remainingHands) {
      const player = hand.x < 0.5 ? players[0] : players[1];
      if (player.active) continue;

      player.hand = { x: hand.x, y: hand.y, landmarks: hand.landmarks };
      player.active = true;
      player.pinch = hand.pinch;
      player.pinching = hand.pinch > 0.58;
    }
  } else {
    const playerOrder =
      remainingHands.length > 1
        ? [...players].sort(
            (a, b) =>
              Math.min(...remainingHands.map((hand) => distance(a.smoothX, a.smoothY, hand.x, hand.y))) -
              Math.min(...remainingHands.map((hand) => distance(b.smoothX, b.smoothY, hand.x, hand.y)))
          )
        : players;

    for (const player of playerOrder) {
      if (!remainingHands.length) break;

      let bestIndex = 0;
      let bestDistance = Infinity;

      for (let i = 0; i < remainingHands.length; i++) {
        const hand = remainingHands[i];
        const d = distance(player.smoothX, player.smoothY, hand.x, hand.y);
        if (d < bestDistance) {
          bestDistance = d;
          bestIndex = i;
        }
      }

      const [hand] = remainingHands.splice(bestIndex, 1);
      player.hand = { x: hand.x, y: hand.y, landmarks: hand.landmarks };
      player.active = true;
      player.pinch = hand.pinch;
      player.pinching = hand.pinch > 0.58;
    }
  }

  for (const player of players) {
    const fallbackX = player.side === "left" ? 0.2 : 0.8;
    const fallbackY = 0.5;
    player.prevX = player.smoothX;
    player.prevY = player.smoothY;
    player.smoothX = THREE.MathUtils.lerp(
      player.smoothX,
      player.hand?.x ?? fallbackX,
      player.active ? 0.25 : 0.08
    );
    player.smoothY = THREE.MathUtils.lerp(
      player.smoothY,
      player.hand?.y ?? fallbackY,
      player.active ? 0.25 : 0.08
    );
    player.velocityX = player.smoothX - player.prevX;
    player.velocityY = player.smoothY - player.prevY;
  }

  const activeCount = players.filter((player) => player.active).length;
  gameState.hadTrackedHands = activeCount > 0;
  gestureText.textContent = activeCount === 2 ? "2 PLAYERS" : activeCount === 1 ? "1 PLAYER" : "NO HAND";
}

function updateGameState() {
  const { ball } = gameState;
  if (ball.stealCooldown > 0) ball.stealCooldown -= 1;
  if (gameState.scoreEffect.active) {
    gameState.scoreEffect.timer += 1;
    if (gameState.scoreEffect.timer >= gameState.scoreEffect.duration) {
      gameState.scoreEffect.active = false;
      gameState.scoreEffect.timer = 0;
    }
  }

  if (gameState.owner) {
    const owner = players.find((player) => player.id === gameState.owner);

    if (owner?.active && owner.pinching) {
      ball.x = THREE.MathUtils.lerp(ball.x, owner.smoothX, 0.34);
      ball.y = THREE.MathUtils.lerp(ball.y, owner.smoothY, 0.34);
      ball.vx = owner.velocityX * 1.6;
      ball.vy = owner.velocityY * 1.6;
      ball.pulse = THREE.MathUtils.lerp(ball.pulse, 1, 0.14);

      const opponent = players.find((player) => player.id !== owner.id);
      if (
        opponent?.active &&
        opponent.pinching &&
        distance(opponent.smoothX, opponent.smoothY, ball.x, ball.y) < 0.09 &&
        ball.stealCooldown <= 0
      ) {
        gameState.owner = opponent.id;
        ball.stealCooldown = 18;
        setMessage(`${opponent.id} stole the orb and took control.`);
      }

      if (owner.side === "left" && ball.x < 0.12) {
        scorePoint(owner);
      } else if (owner.side === "right" && ball.x > 0.88) {
        scorePoint(owner);
      }
    } else {
      if (owner) {
        ball.vx = THREE.MathUtils.clamp(owner.velocityX * 2.8, -0.09, 0.09);
        ball.vy = THREE.MathUtils.clamp(owner.velocityY * 2.8, -0.09, 0.09);
      }
      gameState.owner = null;
      setMessage("Throw released. The energy orb is gliding freely.");
    }
  } else {
    let closestPlayer = null;
    let closestDistance = Infinity;

    for (const player of players) {
      if (!player.active) continue;
      const d = distance(player.smoothX, player.smoothY, ball.x, ball.y);
      if (d < closestDistance) {
        closestDistance = d;
        closestPlayer = player;
      }
    }

    if (closestPlayer && closestPlayer.pinching && closestDistance < 0.095) {
      gameState.owner = closestPlayer.id;
      ball.stealCooldown = 12;
      ball.vx = 0;
      ball.vy = 0;
      setMessage(`${closestPlayer.id} grabbed the energy orb. Throw it toward your scoring zone.`);
    } else {
      ball.x += ball.vx;
      ball.y += ball.vy;
      ball.vx *= 0.96;
      ball.vy *= 0.96;

      if (Math.abs(ball.vx) < 0.0004) ball.vx = 0;
      if (Math.abs(ball.vy) < 0.0004) ball.vy = 0;

      if (ball.y < 0.08) {
        ball.y = 0.08;
        ball.vy *= -0.72;
      } else if (ball.y > 0.92) {
        ball.y = 0.92;
        ball.vy *= -0.72;
      }

      if (ball.x < 0.12) {
        if (ball.vx < 0) {
          scorePoint(players[0]);
          return;
        }
        ball.x = 0.12;
        ball.vx *= -0.78;
      } else if (ball.x > 0.88) {
        if (ball.vx > 0) {
          scorePoint(players[1]);
          return;
        }
        ball.x = 0.88;
        ball.vx *= -0.78;
      }

      if (ball.vx === 0 && ball.vy === 0) {
        ball.x = THREE.MathUtils.lerp(ball.x, 0.5, 0.03);
        ball.y = THREE.MathUtils.lerp(ball.y, 0.5, 0.03);
      }

      ball.pulse = THREE.MathUtils.lerp(
        ball.pulse,
        Math.min(1, Math.abs(ball.vx) * 10 + Math.abs(ball.vy) * 10 + 0.25),
        0.06
      );
    }
  }

  ball.smoothX = THREE.MathUtils.lerp(ball.smoothX, ball.x, 0.2);
  ball.smoothY = THREE.MathUtils.lerp(ball.smoothY, ball.y, 0.2);
}

function scorePoint(player) {
  player.score += 1;
  scoreLeft.textContent = String(players[0].score);
  scoreRight.textContent = String(players[1].score);
  triggerScoreEffect(player);
  setMessage(`${player.id} scored. Current score: ${players[0].score} : ${players[1].score}`);
  gameState.owner = null;
  gameState.ball.x = 0.5;
  gameState.ball.y = 0.5;
  gameState.ball.smoothX = 0.5;
  gameState.ball.smoothY = 0.5;
  gameState.ball.pulse = 1.4;
  gameState.ball.stealCooldown = 24;
  gameState.ball.vx = 0;
  gameState.ball.vy = 0;
}

function triggerScoreEffect(player) {
  gameState.scoreEffect.active = true;
  gameState.scoreEffect.timer = 0;
  gameState.scoreEffect.side = player.side;
  gameState.scoreEffect.color = player.side === "left" ? "rgba(110, 242, 255, 1)" : "rgba(255, 142, 161, 1)";
}

function setMessage(text) {
  if (gameState.lastMessage === text) return;
  gameState.lastMessage = text;
  gameMessage.textContent = text;
}

function drawOverlay() {
  overlayCtx.clearRect(0, 0, overlay.width, overlay.height);

  drawGoalZone(0, "rgba(110, 242, 255, 0.12)");
  drawGoalZone(overlay.width * 0.88, "rgba(255, 142, 161, 0.12)");
  drawScoreEffect();

  for (const player of players) {
    if (!player.hand) continue;
    drawPlayerHand(player);
  }

  drawBallOverlay();
}

function drawGoalZone(x, color) {
  overlayCtx.fillStyle = color;
  overlayCtx.fillRect(x, 0, overlay.width * 0.12, overlay.height);
}

function drawScoreEffect() {
  const effect = gameState.scoreEffect;
  if (!effect?.active) return;

  const progress = effect.timer / effect.duration;
  const fade = 1 - Math.min(1, progress);
  const zoneWidth = overlay.width * 0.12;
  const centerX = effect.side === "left" ? zoneWidth * 0.5 : overlay.width - zoneWidth * 0.5;
  const centerY = overlay.height * 0.5;
  const flashWidth = overlay.width * (0.18 + progress * 0.18);
  const ringRadius = Math.min(overlay.width, overlay.height) * (0.08 + progress * 0.28);

  overlayCtx.save();
  overlayCtx.globalAlpha = 0.34 * fade;
  overlayCtx.fillStyle = effect.color;
  overlayCtx.fillRect(effect.side === "left" ? 0 : overlay.width - flashWidth, 0, flashWidth, overlay.height);

  overlayCtx.globalAlpha = 1;
  overlayCtx.lineWidth = 8 * fade + 2;
  overlayCtx.strokeStyle = effect.color.replace(", 1)", `, ${0.8 * fade})`);
  overlayCtx.beginPath();
  overlayCtx.arc(centerX, centerY, ringRadius, 0, Math.PI * 2);
  overlayCtx.stroke();

  const radial = overlayCtx.createRadialGradient(centerX, centerY, 0, centerX, centerY, ringRadius * 1.8);
  radial.addColorStop(0, effect.color.replace(", 1)", `, ${0.34 * fade})`));
  radial.addColorStop(0.45, effect.color.replace(", 1)", `, ${0.2 * fade})`));
  radial.addColorStop(1, effect.color.replace(", 1)", ", 0)"));
  overlayCtx.fillStyle = radial;
  overlayCtx.beginPath();
  overlayCtx.arc(centerX, centerY, ringRadius * 1.8, 0, Math.PI * 2);
  overlayCtx.fill();

  overlayCtx.font = `700 ${Math.round(42 + progress * 18)}px "Space Grotesk", sans-serif`;
  overlayCtx.textAlign = "center";
  overlayCtx.textBaseline = "middle";
  overlayCtx.fillStyle = `rgba(236, 251, 255, ${0.9 * fade})`;
  overlayCtx.fillText("SCORE!", centerX, centerY);
  overlayCtx.restore();
}

function drawPlayerHand(player) {
  overlayCtx.save();
  overlayCtx.fillStyle = player.color;
  overlayCtx.strokeStyle = player.color;
  overlayCtx.lineWidth = 2;

  for (const point of player.hand.landmarks) {
    const x = (1 - point.x) * overlay.width;
    const y = point.y * overlay.height;
    overlayCtx.beginPath();
    overlayCtx.arc(x, y, 4, 0, Math.PI * 2);
    overlayCtx.fill();
  }

  const px = player.smoothX * overlay.width;
  const py = player.smoothY * overlay.height;
  overlayCtx.beginPath();
  overlayCtx.arc(px, py, 26, 0, Math.PI * 2);
  overlayCtx.stroke();

  if (player.pinching) {
    overlayCtx.globalAlpha = 0.22 + player.pinch * 0.32;
    overlayCtx.beginPath();
    overlayCtx.arc(px, py, 40, 0, Math.PI * 2);
    overlayCtx.fill();
    overlayCtx.globalAlpha = 1;
  }

  overlayCtx.font = "700 18px 'Space Grotesk', sans-serif";
  overlayCtx.fillText(player.id, px - 12, py - 34);
  overlayCtx.restore();
}

function getBallPalette() {
  const owner = players.find((player) => player.id === gameState.owner);
  if (!owner) {
    return {
      core: "#fff4aa",
      glow: "rgba(110, 242, 255, 0.34)",
      outer: "rgba(110, 242, 255, 0)"
    };
  }

  if (owner.id === "P1") {
    return {
      core: "#6ef2ff",
      glow: "rgba(110, 242, 255, 0.45)",
      outer: "rgba(110, 242, 255, 0)"
    };
  }

  return {
    core: "#ff8ea1",
    glow: "rgba(255, 142, 161, 0.45)",
    outer: "rgba(255, 142, 161, 0)"
  };
}

function drawBallOverlay() {
  const ballX = gameState.ball.smoothX * overlay.width;
  const ballY = gameState.ball.smoothY * overlay.height;
  const glow = (28 + gameState.ball.pulse * 28) * BALL_SCALE;
  const palette = getBallPalette();

  const radial = overlayCtx.createRadialGradient(ballX, ballY, 0, ballX, ballY, glow);
  radial.addColorStop(0, palette.core);
  radial.addColorStop(0.45, palette.glow);
  radial.addColorStop(1, palette.outer);
  overlayCtx.fillStyle = radial;
  overlayCtx.beginPath();
  overlayCtx.arc(ballX, ballY, glow, 0, Math.PI * 2);
  overlayCtx.fill();
}

function initThreeScene(container) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(container.clientWidth, container.clientHeight);
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(
    42,
    container.clientWidth / container.clientHeight,
    0.1,
    100
  );
  camera.position.set(0, 0.6, 5.5);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enablePan = false;
  controls.enableZoom = false;
  controls.enableDamping = true;
  controls.enableRotate = false;
  controls.autoRotate = false;

  const ambient = new THREE.AmbientLight(0xa8fdff, 0.85);
  scene.add(ambient);

  const keyLight = new THREE.PointLight(0x67e8ff, 14, 20);
  keyLight.position.set(3, 2, 5);
  scene.add(keyLight);

  const rimLight = new THREE.PointLight(0xff8ea1, 16, 24);
  rimLight.position.set(-3, -2, 4);
  scene.add(rimLight);

  const ballGroup = new THREE.Group();
  scene.add(ballGroup);

  const core = new THREE.Mesh(
    new THREE.IcosahedronGeometry(0.44, 3),
    new THREE.MeshPhysicalMaterial({
      color: 0xfff4aa,
      emissive: 0x2fe3ff,
      emissiveIntensity: 1.4,
      roughness: 0.1,
      metalness: 0.22,
      transparent: true,
      opacity: 0.92,
      transmission: 0.2,
      clearcoat: 1
    })
  );
  ballGroup.add(core);

  const wire = new THREE.Mesh(
    new THREE.IcosahedronGeometry(0.59, 1),
    new THREE.MeshBasicMaterial({
      color: 0x72f0ff,
      wireframe: true,
      transparent: true,
      opacity: 0.52
    })
  );
  ballGroup.add(wire);

  const playerMarkers = players.map((player) => {
    const marker = new THREE.Mesh(
      new THREE.SphereGeometry(0.22, 24, 24),
      new THREE.MeshBasicMaterial({
        color: new THREE.Color(player.color),
        transparent: true,
        opacity: 0.82
      })
    );
    scene.add(marker);
    return marker;
  });

  const leftGate = new THREE.Mesh(
    new THREE.BoxGeometry(0.18, 3.8, 1.6),
    new THREE.MeshBasicMaterial({ color: 0x6ef2ff, transparent: true, opacity: 0.22 })
  );
  leftGate.position.set(-3.05, 0, 0);
  scene.add(leftGate);

  const rightGate = new THREE.Mesh(
    new THREE.BoxGeometry(0.18, 3.8, 1.6),
    new THREE.MeshBasicMaterial({ color: 0xff8ea1, transparent: true, opacity: 0.22 })
  );
  rightGate.position.set(3.05, 0, 0);
  scene.add(rightGate);

  const particlesGeometry = new THREE.BufferGeometry();
  const particleCount = 700;
  const positions = new Float32Array(particleCount * 3);
  for (let i = 0; i < particleCount; i++) {
    const radius = 2.2 + Math.random() * 1.4;
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    positions[i * 3] = radius * Math.sin(phi) * Math.cos(theta);
    positions[i * 3 + 1] = radius * Math.sin(phi) * Math.sin(theta);
    positions[i * 3 + 2] = radius * Math.cos(phi);
  }
  particlesGeometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  const particles = new THREE.Points(
    particlesGeometry,
    new THREE.PointsMaterial({
      color: 0x8ffcff,
      size: 0.03,
      transparent: true,
      opacity: 0.88
    })
  );
  scene.add(particles);

  const floor = new THREE.Mesh(
    new THREE.CircleGeometry(6.5, 80),
    new THREE.MeshBasicMaterial({
      color: 0x0d2d35,
      transparent: true,
      opacity: 0.22
    })
  );
  floor.position.y = -2.4;
  floor.rotation.x = -Math.PI / 2;
  scene.add(floor);

  const clock = new THREE.Clock();

  function resize() {
    camera.aspect = container.clientWidth / container.clientHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(container.clientWidth, container.clientHeight);
  }

  function update() {
    const elapsed = clock.getElapsedTime();
    controls.enabled = false;
    controls.update();
    const palette = getBallPalette();

    ballGroup.position.x = THREE.MathUtils.lerp(ballGroup.position.x, (gameState.ball.smoothX - 0.5) * 6, 0.18);
    ballGroup.position.y = THREE.MathUtils.lerp(ballGroup.position.y, (0.5 - gameState.ball.smoothY) * 3.4, 0.18);

    const pulseScale = 1 + gameState.ball.pulse * 0.34;
    ballGroup.scale.setScalar(THREE.MathUtils.lerp(ballGroup.scale.x, pulseScale, 0.12));

    core.rotation.x += 0.008;
    core.rotation.y += 0.012;
    wire.rotation.x -= 0.005;
    wire.rotation.y += 0.008;
    core.material.color.set(palette.core);
    core.material.emissive.set(palette.core);
    wire.material.color.set(palette.core);
    core.material.emissiveIntensity = 1.2 + gameState.ball.pulse * 1.4;

    particles.rotation.y = elapsed * 0.06;
    particles.rotation.x = elapsed * 0.03;
    particles.material.size = 0.028 + gameState.ball.pulse * 0.012;

    playerMarkers.forEach((marker, index) => {
      const player = players[index];
      marker.position.x = (player.smoothX - 0.5) * 6;
      marker.position.y = (0.5 - player.smoothY) * 3.4;
      marker.position.z = 0.8;
      marker.scale.setScalar(player.active ? 1 : 0.7);
      marker.material.opacity = player.active ? 0.95 : 0.18;
    });

    leftGate.material.opacity = players[0].active ? 0.34 : 0.16;
    rightGate.material.opacity = players[1].active ? 0.34 : 0.16;

    renderer.render(scene, camera);
  }

  return { resize, update };
}

function updateThreeScene() {
  threeState.update();
}

function distance(ax, ay, bx, by) {
  return Math.hypot(ax - bx, ay - by);
}

function describeCameraError(error) {
  if (!error?.name) return "Unable to start the camera. Please check your device or browser settings.";

  const map = {
    NotAllowedError: "Camera access was denied. Please allow camera permission in your browser.",
    NotFoundError: "No camera was found on this device.",
    NotReadableError: "The camera is already in use by another application.",
    OverconstrainedError: "The requested camera settings are not supported on this device."
  };

  return map[error.name] ?? `Camera error: ${error.name}`;
}

window.addEventListener("beforeunload", () => {
  if (animationFrameId) cancelAnimationFrame(animationFrameId);
  webcamStream?.getTracks().forEach((track) => track.stop());
});
