"use client";

import { useRef } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { Float, MeshDistortMaterial, PerspectiveCamera } from "@react-three/drei";
import type { Mesh } from "three";

function FloatingOrbs() {
  const mesh1 = useRef<Mesh>(null);
  const mesh2 = useRef<Mesh>(null);

  useFrame((state) => {
    const t = state.clock.getElapsedTime();
    if (mesh1.current) {
      mesh1.current.rotation.x = t * 0.15;
      mesh1.current.rotation.y = t * 0.2;
    }
    if (mesh2.current) {
      mesh2.current.rotation.x = -t * 0.1;
      mesh2.current.rotation.z = t * 0.15;
    }
  });

  return (
    <>
      <Float speed={2} rotationIntensity={0.5} floatIntensity={1}>
        <mesh ref={mesh1} position={[-2.5, 1, -2]} scale={1.2}>
          <torusGeometry args={[1, 0.3, 16, 32]} />
          <MeshDistortMaterial color="#123f5c" speed={2} distort={0.3} roughness={0.2} metalness={0.8} />
        </mesh>
      </Float>

      <Float speed={1.5} rotationIntensity={0.4} floatIntensity={0.8}>
        <mesh ref={mesh2} position={[3, -1.2, -3]} scale={0.9}>
          <icosahedronGeometry args={[1, 1]} />
          <MeshDistortMaterial color="#65aabc" speed={1.5} distort={0.4} roughness={0.1} metalness={0.9} />
        </mesh>
      </Float>
    </>
  );
}

export function Aura3dOrbit() {
  return (
    <div className="absolute inset-0 pointer-events-none opacity-40 z-0 overflow-hidden">
      <Canvas>
        <PerspectiveCamera makeDefault position={[0, 0, 5]} fov={50} />
        <ambientLight intensity={0.6} />
        <directionalLight position={[10, 10, 5]} intensity={1.2} />
        <pointLight position={[-10, -10, -5]} intensity={0.5} color="#75c2d0" />
        <FloatingOrbs />
      </Canvas>
    </div>
  );
}
