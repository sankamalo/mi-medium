// Modelos de fuera (Blender y demás) para usar de referencia. Los lectores se cargan al primer uso.
import * as THREE from 'three';

export const REF_TYPES = ['fbx', 'obj', 'glb'];
export const refType = (name) => name.split('.').pop().toLowerCase();

// De los bytes del archivo a un objeto de three.js. Se queda solo con las mallas.
export async function parseModel(name, buf) {
  const kind = refType(name);
  let root;
  if (kind === 'fbx') {
    const { FBXLoader } = await import('three/addons/loaders/FBXLoader.js');
    root = new FBXLoader().parse(buf, '');
  } else if (kind === 'obj') {
    const { OBJLoader } = await import('three/addons/loaders/OBJLoader.js');
    root = new OBJLoader().parse(new TextDecoder().decode(buf));
  } else if (kind === 'glb') {
    const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
    root = (await new GLTFLoader().parseAsync(buf, '')).scene;
  } else throw new Error('tipo');
  const out = new THREE.Group();
  root.updateMatrixWorld(true);
  root.traverse((o) => {
    if (!o.isMesh) return;
    const g = o.geometry.clone().applyMatrix4(o.matrixWorld);
    if (!g.attributes.normal) g.computeVertexNormals();
    out.add(new THREE.Mesh(g));
  });
  if (!out.children.length) throw new Error('vacío');
  return out;
}
