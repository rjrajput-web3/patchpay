/** components/CoinField.tsx — immersive 3D hero background.
 *  Floating metallic coins + particle starfield + mouse-parallax camera.
 *  Brand palette: navy #0B1020, cyan #35D6FF, violet #7865FF, gold coins.
 *  Pauses when off-screen / tab hidden; honors prefers-reduced-motion.
 */
"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";

const NAVY = 0x0b1020;
const CYAN = 0x35d6ff;
const VIOLET = 0x7865ff;
const GOLD = 0xe6b34d;
const GOLD_DARK = 0x9a7426;

type Coin = {
  group: THREE.Group;
  spinX: number;
  spinY: number;
  bobAmp: number;
  bobSpeed: number;
  baseY: number;
  phase: number;
};

export function CoinField() {
  const mountRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const isMobile = window.innerWidth < 768;

    // ---------- renderer / scene / camera ----------
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(mount.clientWidth, mount.clientHeight);
    renderer.setClearColor(NAVY, 1);
    mount.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(NAVY, 0.055);

    const camera = new THREE.PerspectiveCamera(
      55,
      mount.clientWidth / mount.clientHeight,
      0.1,
      100
    );
    camera.position.set(0, 0.4, 11);

    // ---------- lights ----------
    scene.add(new THREE.AmbientLight(0xffffff, 0.35));
    const key = new THREE.DirectionalLight(0xfff2d9, 1.6);
    key.position.set(5, 8, 6);
    scene.add(key);
    const cyanLight = new THREE.PointLight(CYAN, 60, 30);
    cyanLight.position.set(-6, 2, 4);
    scene.add(cyanLight);
    const violetLight = new THREE.PointLight(VIOLET, 60, 30);
    violetLight.position.set(6, -3, 5);
    scene.add(violetLight);

    // ---------- coins ----------
    const coins: Coin[] = [];
    const coinCount = isMobile ? 8 : 15;

    const faceGeo = new THREE.CylinderGeometry(1, 1, 0.16, 48);
    const innerGeo = new THREE.CylinderGeometry(0.68, 0.68, 0.2, 48);
    const rimGeo = new THREE.TorusGeometry(0.99, 0.045, 16, 64);

    const faceMat = new THREE.MeshStandardMaterial({
      color: GOLD,
      metalness: 0.95,
      roughness: 0.28,
    });
    const innerMat = new THREE.MeshStandardMaterial({
      color: GOLD_DARK,
      metalness: 0.9,
      roughness: 0.38,
    });
    const rimMat = new THREE.MeshStandardMaterial({
      color: CYAN,
      metalness: 0.6,
      roughness: 0.3,
      emissive: CYAN,
      emissiveIntensity: 0.55,
    });

    // deterministic pseudo-random so the hero looks the same on every load
    let seed = 42;
    const rand = () => {
      seed = (seed * 16807) % 2147483647;
      return (seed - 1) / 2147483646;
    };

    for (let i = 0; i < coinCount; i++) {
      const group = new THREE.Group();
      const face = new THREE.Mesh(faceGeo, faceMat);
      const inner = new THREE.Mesh(innerGeo, innerMat);
      const rim = new THREE.Mesh(rimGeo, rimMat);
      rim.rotation.x = Math.PI / 2;
      group.add(face, inner, rim);

      const s = 0.35 + rand() * 0.75;
      group.scale.setScalar(s);
      group.position.set(
        (rand() - 0.5) * 18,
        (rand() - 0.5) * 9,
        -2 - rand() * 7
      );
      group.rotation.set(rand() * Math.PI, rand() * Math.PI, 0);
      scene.add(group);

      coins.push({
        group,
        spinX: (rand() - 0.5) * 0.9,
        spinY: 0.4 + rand() * 0.9,
        bobAmp: 0.25 + rand() * 0.5,
        bobSpeed: 0.4 + rand() * 0.7,
        baseY: group.position.y,
        phase: rand() * Math.PI * 2,
      });
    }

    // ---------- particle starfield ----------
    const pCount = isMobile ? 220 : 480;
    const pGeo = new THREE.BufferGeometry();
    const pos = new Float32Array(pCount * 3);
    const col = new Float32Array(pCount * 3);
    const palette = [new THREE.Color(CYAN), new THREE.Color(VIOLET), new THREE.Color(0xffffff)];
    for (let i = 0; i < pCount; i++) {
      pos[i * 3] = (rand() - 0.5) * 30;
      pos[i * 3 + 1] = (rand() - 0.5) * 16;
      pos[i * 3 + 2] = -3 - rand() * 12;
      const c = palette[Math.floor(rand() * palette.length)];
      col[i * 3] = c.r;
      col[i * 3 + 1] = c.g;
      col[i * 3 + 2] = c.b;
    }
    pGeo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    pGeo.setAttribute("color", new THREE.BufferAttribute(col, 3));
    const particles = new THREE.Points(
      pGeo,
      new THREE.PointsMaterial({
        size: 0.07,
        vertexColors: true,
        transparent: true,
        opacity: 0.85,
        depthWrite: false,
      })
    );
    scene.add(particles);

    // ---------- interaction state ----------
    const mouse = { x: 0, y: 0 };
    const onMouse = (e: MouseEvent) => {
      const r = mount.getBoundingClientRect();
      mouse.x = ((e.clientX - r.left) / r.width - 0.5) * 2;
      mouse.y = -((e.clientY - r.top) / r.height - 0.5) * 2;
    };
    window.addEventListener("mousemove", onMouse);

    let visible = true;
    const io = new IntersectionObserver(([e]) => (visible = e.isIntersecting), {
      threshold: 0,
    });
    io.observe(mount);

    const onResize = () => {
      const w = mount.clientWidth;
      const h = mount.clientHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    window.addEventListener("resize", onResize);

    // ---------- loop ----------
    const clock = new THREE.Clock();
    let raf = 0;
    const animate = () => {
      raf = requestAnimationFrame(animate);
      if (!visible || document.hidden) return;
      const t = clock.getElapsedTime();

      if (!reduced) {
        for (const c of coins) {
          c.group.rotation.x += c.spinX * 0.008;
          c.group.rotation.y += c.spinY * 0.012;
          c.group.position.y = c.baseY + Math.sin(t * c.bobSpeed + c.phase) * c.bobAmp;
        }
        particles.rotation.y = t * 0.015;
        cyanLight.position.x = -6 + Math.sin(t * 0.5) * 1.5;
        violetLight.position.x = 6 + Math.cos(t * 0.4) * 1.5;
      }

      // mouse-parallax camera drift
      camera.position.x += (mouse.x * 1.4 - camera.position.x) * 0.04;
      camera.position.y += (0.4 + mouse.y * 0.9 - camera.position.y) * 0.04;
      camera.lookAt(0, 0, -2);

      renderer.render(scene, camera);
    };
    animate();

    // ---------- cleanup ----------
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("mousemove", onMouse);
      window.removeEventListener("resize", onResize);
      io.disconnect();
      scene.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (mesh.geometry) mesh.geometry.dispose();
      });
      faceGeo.dispose();
      innerGeo.dispose();
      rimGeo.dispose();
      pGeo.dispose();
      (particles.material as THREE.Material).dispose();
      renderer.dispose();
      if (renderer.domElement.parentElement === mount) {
        mount.removeChild(renderer.domElement);
      }
    };
  }, []);

  return (
    <div
      ref={mountRef}
      aria-hidden="true"
      className="pointer-events-none absolute inset-0"
    />
  );
}
