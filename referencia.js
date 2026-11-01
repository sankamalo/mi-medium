// Modelos de fuera (Blender y demás) para usar de referencia. Los lectores se cargan al primer uso.
import * as THREE from 'three';

export const IMAGE_TYPES = ['png', 'jpg', 'jpeg', 'webp'];
export const REF_TYPES = ['fbx', 'obj', 'glb', ...IMAGE_TYPES];
export const refType = (name) => name.split('.').pop().toLowerCase();

// De los bytes del archivo a un objeto de three.js. Se queda solo con las mallas.
export async function parseModel(name, buf) {
  const kind = refType(name);
  // Una imagen es una lámina del tamaño de la foto.
  if (IMAGE_TYPES.includes(kind)) {
    const bmp = await createImageBitmap(new Blob([buf]), { imageOrientation: 'flipY' });
    const tex = new THREE.Texture(bmp);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.flipY = false;
    tex.needsUpdate = true;
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, side: THREE.DoubleSide, toneMapped: false });
    const out = new THREE.Group();
    out.add(new THREE.Mesh(new THREE.PlaneGeometry(bmp.width / Math.max(bmp.width, bmp.height), bmp.height / Math.max(bmp.width, bmp.height)), mat));
    out.userData.image = mat;
    return out;
  }
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
