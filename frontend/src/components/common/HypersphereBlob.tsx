import { useEffect, useRef } from "react";
import * as THREE from "three";
import { BLOB_FRAGMENT_SHADER, BLOB_VERTEX_SHADER } from "../../webgl/blobShaders";

/** A single distorted/noisy sphere ("blob"), per the technique documented in
 * https://github.com/codrops/WebGLBlobs -- an icosahedron displaced along its normals by 3D
 * Perlin noise, twisted with a sine-driven rotation, and coloured with a cosine palette. Reacts
 * gently to mouse movement over the canvas, like the original demo's scene-level parallax. */
export function HypersphereBlob() {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
    camera.position.set(0, 0, 7);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.appendChild(renderer.domElement);

    const geometry = new THREE.IcosahedronGeometry(1, 48);
    const material = new THREE.ShaderMaterial({
      vertexShader: BLOB_VERTEX_SHADER,
      fragmentShader: BLOB_FRAGMENT_SHADER,
      transparent: true,
      uniforms: {
        uTime: { value: 0 },
        uSpeed: { value: 0.25 },
        uNoiseDensity: { value: 0.9 },
        uNoiseStrength: { value: 0.3 },
        uFreq: { value: 2.0 },
        uAmp: { value: 0.6 },
        uIntensity: { value: 4.0 },
        uAlpha: { value: 1.0 },
      },
    });
    const mesh = new THREE.Mesh(geometry, material);
    scene.add(mesh);

    const startTime = performance.now();
    const mouse = new THREE.Vector2();
    const mouseTarget = new THREE.Vector2();

    const resize = () => {
      const { clientWidth: width, clientHeight: height } = container;
      if (width === 0 || height === 0) return;
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height);
    };
    resize();

    const onMouseMove = (e: MouseEvent) => {
      const rect = container.getBoundingClientRect();
      mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    };

    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(container);
    window.addEventListener("mousemove", onMouseMove);

    let frameId: number;
    const animate = () => {
      frameId = requestAnimationFrame(animate);
      material.uniforms.uTime.value = (performance.now() - startTime) / 1000;

      mouseTarget.x += (mouse.x - mouseTarget.x) * 0.03;
      mouseTarget.y += (mouse.y - mouseTarget.y) * 0.03;
      mesh.rotation.y = mouseTarget.x * 0.6;
      mesh.rotation.x = mouseTarget.y * 0.3;

      renderer.render(scene, camera);
    };
    animate();

    return () => {
      cancelAnimationFrame(frameId);
      resizeObserver.disconnect();
      window.removeEventListener("mousemove", onMouseMove);
      container.removeChild(renderer.domElement);
      geometry.dispose();
      material.dispose();
      renderer.dispose();
    };
  }, []);

  return <div ref={containerRef} className="hypersphere-blob" />;
}
