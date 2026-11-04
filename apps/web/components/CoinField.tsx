/** components/CoinField.tsx — immersive 3D hero background.
 *  One large premium 3D NEAR coin (official NEAR "N" mark on the face,
 *  metallic PBR material, studio lighting with cyan/violet reflections)
 *  slowly rotating behind the hero, plus 2 smaller coins at depth.
 *  Mouse parallax on desktop, touch parallax on mobile.
 *  Pauses when off-screen / tab hidden; honors prefers-reduced-motion.
 *  No starfield — clean deep-navy background, ambient glows are CSS.
 */
"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";

/** Official NEAR "N" mark (viewBox 0 0 90.1 90), from the official brand asset. */
const NEAR_PATH =
  "M72.2,4.6L53.4,32.5c-1.3,1.9,1.2,4.2,3,2.6L74.9,19c0.5-0.4,1.2-0.1,1.2,0.6v50.3c0,0.7-0.9,1-1.3,0.5l-56-67 C17,1.2,14.4,0,11.5,0h-2C4.3,0,0,4.3,0,9.6v70.8C0,85.7,4.3,90,9.6,90c3.3,0,6.4-1.7,8.2-4.6l18.8-27.9c1.3-1.9-1.2-4.2-3-2.6 l-18.5,16c-0.5,0.4-1.2,0.1-1.2-0.6V20.1c0-0.7,0.9-1,1.3-0.5l56,67c1.8,2.2,4.5,3.4,7.3,3.4h2c5.3,0,9.6-4.3,9.6-9.6V9.6 c0-5.3-4.3-9.6-9.6-9.6C77.1,0,74,1.7,72.2,4.6z";

/** Paint the coin face: dark metallic disc, official NEAR mark in brand gradient. */
function makeCoinFaceTexture(): THREE.CanvasTexture {
  const S = 512;
  const cv = document.createElement("canvas");
  cv.width = cv.height = S;
  const g = cv.getContext("2d")!;

  // dark metallic base
  const base = g.createRadialGradient(S * 0.38, S * 0.34, S * 0.05, S / 2, S / 2, S / 2);
  base.addColorStop(0, "#2a3757");
  base.addColorStop(0.55, "#141d33");
  base.addColorStop(1, "#0a0f1f");
  g.fillStyle = base;
  g.fillRect(0, 0, S, S);

  // brushed-metal sheen arcs
  g.save();
  g.globalAlpha = 0.10;
  g.strokeStyle = "#ffffff";
  for (let r = 60; r < S / 2; r += 26) {
    g.lineWidth = 9;
    g.beginPath();
    g.arc(S / 2, S / 2, r, Math.PI * 1.05, Math.PI * 1.75);
    g.stroke();
  }
  g.restore();

  // outer rim ring — brand cyan/violet metallic
  const rim = g.createLinearGradient(0, 0, S, S);
  rim.addColorStop(0, "#35D6FF");
  rim.addColorStop(0.5, "#7f9dff");
  rim.addColorStop(1, "#7865FF");
  g.strokeStyle = rim;
  g.lineWidth = 14;
  g.beginPath();
  g.arc(S / 2, S / 2, S / 2 - 16, 0, Math.PI * 2);
  g.stroke();
  // thin inner ring
  g.globalAlpha = 0.5;
  g.lineWidth = 3;
  g.beginPath();
  g.arc(S / 2, S / 2, S / 2 - 34, 0, Math.PI * 2);
  g.stroke();
  g.globalAlpha = 1;

  // official NEAR "N" — scaled into the center, brand gradient fill
  const scale = (S * 0.52) / 90.1;
  const grad = g.createLinearGradient(S * 0.2, S * 0.2, S * 0.8, S * 0.8);
  grad.addColorStop(0, "#6ff3ff");
  grad.addColorStop(0.5, "#35D6FF");
  grad.addColorStop(1, "#8f7bff");
  g.fillStyle = grad;
  g.save();
  g.translate(S / 2 - (90.1 * scale) / 2, S / 2 - (90 * scale) / 2);
  g.scale(scale, scale);
  g.fill(new Path2D(NEAR_PATH));
  g.restore();

  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function makeCoin(radius: number, faceTex: THREE.Texture): THREE.Mesh {
  const geo = new THREE.CylinderGeometry(radius, radius, radius * 0.18, 96, 1);
  const sideMat = new THREE.MeshStandardMaterial({
    color: 0x8a93ad,
    metalness: 1.0,
    roughness: 0.32,
  });
  const faceMat = new THREE.MeshStandardMaterial({
    map: faceTex,
    metalness: 0.85,
    roughness: 0.28,
  });
  const coin = new THREE.Mesh(geo, [sideMat, faceMat, faceMat]);
  // tip the coin so its face catches the camera, like a display piece
  coin.rotation.x = Math.PI / 2 - 0.22;
  coin.rotation.z = 0.12;
  return coin;
}

export function CoinField() {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = ref.current;
    if (!host) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const isMobile = window.innerWidth < 768;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, isMobile ? 1.25 : 1.75));
    renderer.setSize(host.clientWidth, host.clientHeight);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    host.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(
      42,
      host.clientWidth / host.clientHeight,
      0.1,
      60
    );
    camera.position.set(0, 0, 10);

    // studio reflections for the metal
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

    // brand lighting: cool key + cyan rim + violet fill
    const key = new THREE.DirectionalLight(0xffffff, 1.6);
    key.position.set(5, 7, 8);
    scene.add(key);
    const cyan = new THREE.PointLight(0x35d6ff, 220, 40, 1.8);
    cyan.position.set(-7, 2, 4);
    scene.add(cyan);
    const violet = new THREE.PointLight(0x7865ff, 200, 40, 1.8);
    violet.position.set(7, -3, 3);
    scene.add(violet);
    scene.add(new THREE.AmbientLight(0x223055, 0.7));

    const faceTex = makeCoinFaceTexture();

    interface CoinSpec {
      mesh: THREE.Mesh;
      baseY: number;
      spin: number;
      bobAmp: number;
      bobSpeed: number;
      phase: number;
      /** edge anchor: recompute x from viewport on resize ("left" | "right" | null) */
      anchor: "left" | "right" | null;
      anchorZ: number;
      anchorMargin: number;
    }
    const coins: CoinSpec[] = [];
    const addCoin = (
      radius: number,
      x: number,
      y: number,
      z: number,
      spin: number,
      bobAmp: number,
      bobSpeed: number,
      phase: number,
      anchor: "left" | "right" | null = null,
      anchorMargin = 0
    ) => {
      const mesh = makeCoin(radius, faceTex);
      mesh.position.set(x, y, z);
      scene.add(mesh);
      coins.push({ mesh, baseY: y, spin, bobAmp, bobSpeed, phase, anchor, anchorZ: z, anchorMargin });
    };

    // Depth coins are anchored to the viewport edges at runtime, so they
    // stay clear of the centered text column at ANY screen width.
    const halfWAt = (z: number) => {
      const dist = camera.position.z - z;
      return Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * dist * camera.aspect;
    };

    if (isMobile) {
      // mobile: hero coin peeks from top-right, one small coin bottom-left
      addCoin(0.85, 2.2, 3.2, -2.6, 0.0038, 0.1, 0.55, 0);
      addCoin(0.6, -1.5, -2.6, -4.0, 0.0022, 0.16, 0.4, 2.1);
    } else {
      // desktop: large hero coin right-of-center; small coins tucked into
      // the empty top-left and bottom-right corners, clear of all copy
      addCoin(2.35, 3.4, 0.15, -1.6, 0.0032, 0.2, 0.5, 0);
      addCoin(0.85, -halfWAt(-5.5) + 1.1, 3.4, -5.5, 0.002, 0.2, 0.38, 1.4, "left", 1.1);
      addCoin(0.68, halfWAt(-5.0) - 1.0, -2.9, -5.0, 0.0015, 0.24, 0.3, 2.8, "right", 1.0);
    }

    // parallax targets (mouse on desktop, touch on mobile)
    const target = { x: 0, y: 0 };
    const onMouse = (e: MouseEvent) => {
      target.x = (e.clientX / window.innerWidth - 0.5) * 1.6;
      target.y = -(e.clientY / window.innerHeight - 0.5) * 1.0;
    };
    const onTouch = (e: TouchEvent) => {
      const t = e.touches[0];
      if (!t) return;
      target.x = (t.clientX / window.innerWidth - 0.5) * 1.2;
      target.y = -(t.clientY / window.innerHeight - 0.5) * 0.8;
    };
    if (!isMobile) window.addEventListener("mousemove", onMouse, { passive: true });
    else window.addEventListener("touchmove", onTouch, { passive: true });

    let running = true;
    let raf = 0;
    const clock = new THREE.Clock();

    const renderFrame = () => {
      const t = clock.getElapsedTime();
      for (const c of coins) {
        c.mesh.rotation.y += c.spin;
        c.mesh.position.y = c.baseY + Math.sin(t * c.bobSpeed + c.phase) * c.bobAmp;
        c.mesh.rotation.z = 0.12 + Math.sin(t * 0.3 + c.phase) * 0.03;
      }
      // gentle auto-drift on mobile so it never looks static
      const driftX = isMobile ? Math.sin(t * 0.18) * 0.35 : 0;
      const driftY = isMobile ? Math.cos(t * 0.14) * 0.22 : 0;
      camera.position.x += (target.x + driftX - camera.position.x) * 0.045;
      camera.position.y += (target.y + driftY - camera.position.y) * 0.045;
      camera.lookAt(0, 0, -2);
      renderer.render(scene, camera);
    };

    const loop = () => {
      if (!running) return;
      renderFrame();
      raf = requestAnimationFrame(loop);
    };

    if (reduced) {
      renderFrame(); // one static frame, no motion
    } else {
      // pause when the hero scrolls out of view or the tab hides
      const io = new IntersectionObserver(
        (entries) => {
          const vis = entries[0]?.isIntersecting ?? true;
          if (vis && !document.hidden && !running) {
            running = true;
            clock.getDelta();
            loop();
          } else if (!vis && running) {
            running = false;
            cancelAnimationFrame(raf);
          }
        },
        { threshold: 0 }
      );
      io.observe(host);
      const onVis = () => {
        if (document.hidden && running) {
          running = false;
          cancelAnimationFrame(raf);
        } else if (!document.hidden && !running) {
          running = true;
          clock.getDelta();
          loop();
        }
      };
      document.addEventListener("visibilitychange", onVis);
      loop();
      var cleanupIO = () => {
        io.disconnect();
        document.removeEventListener("visibilitychange", onVis);
      };
    }

    const onResize = () => {
      const w = host.clientWidth;
      const h = host.clientHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
      // keep edge-anchored coins glued to the viewport corners
      for (const c of coins) {
        if (c.anchor === "left") c.mesh.position.x = -halfWAt(c.anchorZ) + c.anchorMargin;
        else if (c.anchor === "right") c.mesh.position.x = halfWAt(c.anchorZ) - c.anchorMargin;
      }
    };
    window.addEventListener("resize", onResize);

    return () => {
      running = false;
      cancelAnimationFrame(raf);
      if (!isMobile) window.removeEventListener("mousemove", onMouse);
      else window.removeEventListener("touchmove", onTouch);
      window.removeEventListener("resize", onResize);
      if (typeof cleanupIO !== "undefined") cleanupIO();
      faceTex.dispose();
      scene.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) {
          m.geometry.dispose();
          const mats = Array.isArray(m.material) ? m.material : [m.material];
          mats.forEach((mm) => mm.dispose());
        }
      });
      pmrem.dispose();
      renderer.dispose();
      host.removeChild(renderer.domElement);
    };
  }, []);

  return (
    <div
      ref={ref}
      aria-hidden="true"
      className="pointer-events-none absolute inset-0"
    />
  );
}
