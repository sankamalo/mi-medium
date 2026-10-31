// Idiomas de la app: español (el texto original), inglés y tailandés.
// t('Guardar') busca la traducción; lo que no está en el diccionario se queda tal cual
// (nombres de capas, números…). {0}, {1} = valores que se insertan en la frase.

const LANGS = ['es', 'en', 'th'];
let lang = 'es';
try { const s = localStorage.getItem('plastilinaLang'); if (LANGS.includes(s)) lang = s; } catch {}

// español: [inglés, tailandés]
const D = {
  // Herramientas
  'Añadir': ['Add', 'เพิ่ม'], 'Quitar': ['Remove', 'ลบออก'], 'Suavizar': ['Smooth', 'ทำให้เรียบ'], 'Suaviz.': ['Smooth', 'เรียบ'],
  'Inflar': ['Inflate', 'ทำให้พอง'], 'Aplanar': ['Flatten', 'ทำให้แบน'], 'Arrastrar': ['Drag', 'ลาก'], 'Pintar': ['Paint', 'ระบายสี'],
  'Mover capa': ['Move layer', 'ย้ายเลเยอร์'], 'Mover': ['Move', 'ย้าย'],
  '+ Resolución': ['+ Resolution', '+ ความละเอียด'], '− Resolución': ['− Resolution', '− ความละเอียด'],
  'Deshacer': ['Undo', 'เลิกทำ'], 'Rehacer': ['Redo', 'ทำซ้ำ'], 'Simetría X': ['Symmetry X', 'สมมาตร X'], 'Simetría': ['Symmetry', 'สมมาตร'],
  'Esfera': ['Sphere', 'ทรงกลม'], 'Cubo': ['Cube', 'ลูกบาศก์'], 'Pirámide': ['Pyramid', 'พีระมิด'],
  'Ver malla': ['Show mesh', 'แสดงตาข่าย'], 'Malla': ['Mesh', 'ตาข่าย'], 'Remesh quads': ['Remesh quads', 'Remesh ควอด'],
  'A Blender': ['To Blender', 'Blender'], 'Guardar': ['Save', 'บันทึก'], 'Compartir': ['Share', 'แชร์'],
  'Nueva capa': ['New layer', 'เลเยอร์ใหม่'], 'Capa siguiente': ['Next layer', 'เลเยอร์ถัดไป'],
  // Menú radial
  'Tamaño': ['Size', 'ขนาด'], 'Estabilizar': ['Stabilize', 'ทำให้นิ่ง'], 'arco de dentro': ['inner arc', 'วงใน'], 'arco de fuera': ['outer arc', 'วงนอก'],
  'Forma del pincel': ['Brush shape', 'รูปทรงแปรง'], 'Espera: formas…': ['Wait: shapes…', 'รอสักครู่: รูปทรง…'],
  'más grande ↗': ['bigger ↗', 'ใหญ่กว่านี้ ↗'], 'tamaño real': ['real size', 'ขนาดจริง'],
  // Panel de las gafas
  'Fuerza': ['Strength', 'ความแรง'], 'Estabilizar (línea recta)': ['Stabilize (straight line)', 'ทำให้นิ่ง (เส้นตรง)'], 'no': ['off', 'ปิด'],
  'COLOR': ['COLOR', 'สี'], 'CAPAS': ['LAYERS', 'เลเยอร์'], '+ Capa': ['+ Layer', '+ เลเยอร์'], 'Ver': ['Show', 'แสดง'],
  'Traer el espacio aquí': ['Bring the workspace here', 'นำพื้นที่ทำงานมาที่นี่'],
  'OBRA: {0}': ['WORK: {0}', 'ผลงาน: {0}'], 'Obras ▸': ['Works ▸', 'ผลงาน ▸'], 'Nueva': ['New', 'ใหม่'],
  'Quads del remesh': ['Remesh quads', 'จำนวนควอด Remesh'], '− Res': ['− Res', '− ละเอียด'], '+ Res': ['+ Res', '+ ละเอียด'], 'Remesh': ['Remesh', 'Remesh'],
  'Apunta con el mando derecho · gatillo = pulsar · clic stick izq. = cerrar': ['Point with the right controller · trigger = press · left stick click = close', 'เล็งด้วยคอนโทรลเลอร์ขวา · ไกปืน = กด · กดคันโยกซ้าย = ปิด'],
  'Obras en las gafas': ['Works on the headset', 'ผลงานในแว่น'], '◂ Volver': ['◂ Back', '◂ กลับ'],
  'Aún no has guardado ninguna. Pulsa Guardar.': ['Nothing saved yet. Press Save.', 'ยังไม่มีผลงานที่บันทึก กดบันทึก'],
  'Abrir otra guarda antes la actual': ['Opening another one saves the current one first', 'เปิดผลงานอื่นจะบันทึกผลงานปัจจุบันก่อน'],
  'sin guardar': ['not saved', 'ยังไม่บันทึก'], '(invertido)': ['(inverted)', '(กลับด้าน)'],
  '{0} · fuerza {1}%': ['{0} · strength {1}%', '{0} · แรง {1}%'], ' · simetría': [' · symmetry', ' · สมมาตร'], ' · malla': [' · mesh', ' · ตาข่าย'],
  // Nombres
  'Capa {0}': ['Layer {0}', 'เลเยอร์ {0}'], 'Obra {0}': ['Work {0}', 'ผลงาน {0}'],
  // Avisos
  '{0} creada (vacía): añade barro con "Añadir"': ['{0} created (empty): add clay with "Add"', 'สร้าง {0} แล้ว (ว่าง): เพิ่มดินด้วย "เพิ่ม"'],
  'Capa activa: {0}': ['Active layer: {0}', 'เลเยอร์ที่ใช้: {0}'], 'No puedes borrar la única capa': ["You can't delete the only layer", 'ลบเลเยอร์เดียวที่มีไม่ได้'],
  '¿Borrar {0}? No se puede deshacer.': ['Delete {0}? This cannot be undone.', 'ลบ {0} ใช่ไหม? ย้อนกลับไม่ได้'],
  'Nada que deshacer': ['Nothing to undo', 'ไม่มีอะไรให้เลิกทำ'], 'Nada que rehacer': ['Nothing to redo', 'ไม่มีอะไรให้ทำซ้ำ'],
  'Resolución máxima': ['Maximum resolution', 'ความละเอียดสูงสุด'], 'Resolución mínima': ['Minimum resolution', 'ความละเอียดต่ำสุด'],
  '{0}: resolución {1}³': ['{0}: resolution {1}³', '{0}: ความละเอียด {1}³'], 'Pincel: {0}': ['Brush: {0}', 'แปรง: {0}'],
  'Simetría ON': ['Symmetry ON', 'เปิดสมมาตร'], 'Simetría OFF': ['Symmetry OFF', 'ปิดสมมาตร'],
  'Ya está haciendo remesh…': ['Already remeshing…', 'กำลัง Remesh อยู่…'], 'La capa está vacía': ['The layer is empty', 'เลเยอร์ว่างเปล่า'],
  '{0} · {1}… {2}%': ['{0} · {1}… {2}%', '{0} · {1}… {2}%'],
  'Malla nueva': ['New mesh', 'ตาข่ายใหม่'], 'Horneando detalle': ['Baking detail', 'กำลังเบกรายละเอียด'],
  '{0}: {1} quads + detalle horneado ({2}px) en {3} s': ['{0}: {1} quads + baked detail ({2}px) in {3} s', '{0}: {1} ควอด + รายละเอียดที่เบก ({2}px) ใน {3} วินาที'],
  'Has esculpido durante el remesh: vuelve a lanzarlo': ['You sculpted during the remesh: run it again', 'คุณปั้นระหว่าง Remesh: ลองใหม่อีกครั้ง'],
  'Remesh falló: {0}': ['Remesh failed: {0}', 'Remesh ล้มเหลว: {0}'], 'sin conexión con el servidor': ['no connection to the server', 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้'],
  'El remesh usa Blender en el Mac: conéctate a su Wi-Fi': ['This remesh uses Blender on the Mac: join its Wi-Fi', 'Remesh นี้ใช้ Blender บน Mac: เชื่อมต่อ Wi-Fi เดียวกัน'],
  'Remesh de {0}: Blender trabajando…': ['Remesh of {0}: Blender working…', 'Remesh {0}: Blender กำลังทำงาน…'], 'La capa se borró': ['The layer was deleted', 'เลเยอร์ถูกลบแล้ว'],
  '{0}: {1} quads uniformes (esculpir lo descarta)': ['{0}: {1} uniform quads (sculpting discards it)', '{0}: {1} ควอดสม่ำเสมอ (ถ้าปั้นต่อจะหายไป)'],
  'Exportando…': ['Exporting…', 'กำลังส่งออก…'], 'Guardado en el Mac: {0} capa(s) · {1} quads': ['Saved on the Mac: {0} layer(s) · {1} quads', 'บันทึกใน Mac แล้ว: {0} เลเยอร์ · {1} ควอด'],
  'No hay nada visible que exportar': ['Nothing visible to export', 'ไม่มีอะไรให้ส่งออก'], 'No se pudo compartir: {0}': ["Couldn't share: {0}", 'แชร์ไม่ได้: {0}'],
  '{0} · {1} capa(s) · {2} quads': ['{0} · {1} layer(s) · {2} quads', '{0} · {1} เลเยอร์ · {2} ควอด'], ' · con texturas': [' · with textures', ' · มีเท็กซ์เจอร์'],
  '. Este navegador no deja compartir este archivo: descárgalo y adjúntalo desde WhatsApp.': ['. This browser cannot share this file: download it and attach it from WhatsApp.', '. เบราว์เซอร์นี้แชร์ไฟล์ไม่ได้: ดาวน์โหลดแล้วแนบจาก WhatsApp'],
  'Descargado en la carpeta Descargas': ['Downloaded to the Downloads folder', 'ดาวน์โหลดไว้ในโฟลเดอร์ Downloads แล้ว'],
  'Capa movida: el remesh se descarta (vuelve a lanzarlo)': ['Layer moved: the remesh is discarded (run it again)', 'ย้ายเลเยอร์แล้ว: Remesh ถูกยกเลิก (ทำใหม่อีกครั้ง)'],
  'Color cogido: {0}': ['Color picked: {0}', 'เลือกสีแล้ว: {0}'], 'No se pudo entrar en las gafas: {0}': ["Couldn't enter the headset: {0}", 'เข้าสู่แว่นไม่ได้: {0}'],
  'Acerca el cursor a una capa para agarrarla': ['Bring the cursor close to a layer to grab it', 'เลื่อนเคอร์เซอร์เข้าใกล้เลเยอร์เพื่อจับ'],
  'Sin conexión con el Mac: sigues trabajando y se guarda en las gafas': ['No connection to the Mac: keep working, it saves on the headset', 'ไม่ได้เชื่อมต่อ Mac: ทำงานต่อได้ บันทึกในแว่น'],
  'Recuperado tu último trabajo': ['Your last work was restored', 'กู้คืนงานล่าสุดแล้ว'], 'Guardado: {0} (en las gafas)': ['Saved: {0} (on the headset)', 'บันทึกแล้ว: {0} (ในแว่น)'],
  'No se pudo guardar: {0}': ["Couldn't save: {0}", 'บันทึกไม่ได้: {0}'], 'No encuentro esa obra': ["Can't find that work", 'ไม่พบผลงานนั้น'], 'Abierta: {0}': ['Opened: {0}', 'เปิด: {0}'],
  'Obra nueva (la anterior está guardada)': ['New work (the previous one is saved)', 'ผลงานใหม่ (บันทึกงานก่อนหน้าแล้ว)'],
  '¿Borrar {0} de las gafas? No se puede deshacer.': ['Delete {0} from the headset? This cannot be undone.', 'ลบ {0} ออกจากแว่นใช่ไหม? ย้อนกลับไม่ได้'],
  'Nombre de la capa': ['Layer name', 'ชื่อเลเยอร์'], 'Nombre de la obra': ['Work name', 'ชื่อผลงาน'], 'Doble clic para renombrar': ['Double-click to rename', 'ดับเบิลคลิกเพื่อเปลี่ยนชื่อ'],
  'Mostrar / ocultar': ['Show / hide', 'แสดง / ซ่อน'], 'Borrar': ['Delete', 'ลบ'],
  'Abre la app por https:// para usar las gafas': ['Open the app over https:// to use the headset', 'เปิดแอปผ่าน https:// เพื่อใช้แว่น'],
  'Estás fuera del espacio de trabajo: acércate al cubo': ['You are outside the workspace: move closer to the cube', 'คุณอยู่นอกพื้นที่ทำงาน: เข้าใกล้ลูกบาศก์'],
  // Pantalla del ordenador
  'LA PLASTILINA': ['LA PLASTILINA', 'LA PLASTILINA'], 'Herramientas': ['Tools', 'เครื่องมือ'], 'Copia': ['Copy', 'สำเนา'], 'Obra': ['Work', 'ผลงาน'], 'Color': ['Color', 'สี'], 'Capas': ['Layers', 'เลเยอร์'],
  '✎ Pintar': ['✎ Paint', '✎ ระบายสี'], 'Color → base capa': ['Color → layer base', 'สี → สีฐานเลเยอร์'], '● Esfera': ['● Sphere', '● ทรงกลม'], '■ Cubo': ['■ Cube', '■ ลูกบาศก์'], '▲ Pirámide': ['▲ Pyramid', '▲ พีระมิด'],
  'Vaciar': ['Clear', 'ล้าง'], 'Remesh + horneado': ['Remesh + bake', 'Remesh + เบก'], 'Quads': ['Quads', 'ควอด'], 'Textura 1K': ['Texture 1K', 'เท็กซ์เจอร์ 1K'],
  'Remesh capa': ['Remesh layer', 'Remesh เลเยอร์'], 'Remesh en Blender': ['Remesh in Blender', 'Remesh ใน Blender'], 'Enviar a Blender': ['Send to Blender', 'ส่งไป Blender'],
  'Compartir (WhatsApp…)': ['Share (WhatsApp…)', 'แชร์ (WhatsApp…)'], 'Gafas: AR (sin fondo)': ['Headset: AR (no background)', 'แว่น: AR (ไม่มีพื้นหลัง)'], 'Gafas: VR': ['Headset: VR', 'แว่น: VR'],
  'Modelo listo': ['Model ready', 'โมเดลพร้อมแล้ว'], 'Compartir…': ['Share…', 'แชร์…'], 'Descargar': ['Download', 'ดาวน์โหลด'], 'Cerrar': ['Close', 'ปิด'],
  'En el Mac: Blender con': ['On the Mac: Blender with', 'บน Mac: Blender พร้อม'], 'abre solo lo que llegue a Descargas.': ['opens whatever reaches Downloads.', 'จะเปิดไฟล์ใน Downloads อัตโนมัติ'],
  'Pincel esfera (Añadir/Quitar)': ['Sphere brush (Add/Remove)', 'แปรงทรงกลม (เพิ่ม/ลบ)'], 'Pincel cubo': ['Cube brush', 'แปรงลูกบาศก์'], 'Pincel pirámide': ['Pyramid brush', 'แปรงพีระมิด'],
  'El pincel va detrás del ratón como con una cuerda: trazos rectos y seguros': ['The brush trails the mouse like on a rope: straight, steady strokes', 'แปรงตามเมาส์เหมือนมีเชือกดึง: เส้นตรงและนิ่ง'],
  'Guardar (Cmd+S)': ['Save (Cmd+S)', 'บันทึก (Cmd+S)'], 'Guardar como obra nueva': ['Save as a new work', 'บันทึกเป็นผลงานใหม่'], 'Empezar otra (la actual se guarda)': ['Start another (the current one is saved)', 'เริ่มใหม่ (บันทึกงานปัจจุบัน)'],
  'Color actual': ['Current color', 'สีปัจจุบัน'], 'Pincel de pintar (P)': ['Paint brush (P)', 'แปรงระบายสี (P)'], 'Usar el color actual como color base de la capa activa': ['Use the current color as the base of the active layer', 'ใช้สีปัจจุบันเป็นสีฐานของเลเยอร์'],
  'Nueva capa (N)': ['New layer (N)', 'เลเยอร์ใหม่ (N)'], 'Rellenar la capa con una esfera': ['Fill the layer with a sphere', 'เติมเลเยอร์ด้วยทรงกลม'], 'Vaciar la capa': ['Clear the layer', 'ล้างเลเยอร์'], 'Borrar la capa': ['Delete the layer', 'ลบเลเยอร์'],
  'Más rápido': ['Faster', 'เร็วกว่า'], 'Más detalle, más lento': ['More detail, slower', 'ละเอียดกว่า ช้ากว่า'], 'Malla nueva + detalle horneado, en este dispositivo (R)': ['New mesh + baked detail, on this device (R)', 'ตาข่ายใหม่ + รายละเอียดที่เบก บนอุปกรณ์นี้ (R)'],
  'QuadriFlow en Blender: sigue mejor la forma (necesita el Mac)': ['QuadriFlow in Blender (needs the Mac)', 'QuadriFlow ใน Blender (ต้องใช้ Mac)'], 'Mandar el modelo por WhatsApp, correo…': ['Send the model by WhatsApp, email…', 'ส่งโมเดลทาง WhatsApp, อีเมล…'],
  'Clic izq. sobre el modelo: esculpir · Clic izq. fuera: girar · Clic der.: dial de herramientas · Botón central: mover vista · Rueda: zoom · SHIFT: suavizar · CTRL: invertir · ALT+clic: coger color · [ ]: tamaño · 1–8: herramientas (8 = arrastrar) · B: forma del pincel · G: mover capa (arrastra · Shift+arrastra = girar · rueda sobre la capa = escalar) · P: pintar · W: ver malla · X: simetría · N: nueva capa · TAB: siguiente capa · R: remesh · E: a Blender · Cmd+Z: deshacer':
    ['Left click on the model: sculpt · Left click outside: orbit · Right click: tool dial · Middle button: pan · Wheel: zoom · SHIFT: smooth · CTRL: invert · ALT+click: pick color · [ ]: size · 1–8: tools (8 = drag) · B: brush shape · G: move layer (drag · Shift+drag = rotate · wheel on the layer = scale) · P: paint · W: show mesh · X: symmetry · N: new layer · TAB: next layer · R: remesh · E: to Blender · Cmd+Z: undo',
      'คลิกซ้ายบนโมเดล: ปั้น · คลิกซ้ายด้านนอก: หมุน · คลิกขวา: วงเครื่องมือ · ปุ่มกลาง: เลื่อนมุมมอง · ลูกกลิ้ง: ซูม · SHIFT: ทำให้เรียบ · CTRL: กลับด้าน · ALT+คลิก: เลือกสี · [ ]: ขนาด · 1–8: เครื่องมือ (8 = ลาก) · B: รูปทรงแปรง · G: ย้ายเลเยอร์ (ลาก · Shift+ลาก = หมุน · ลูกกลิ้งบนเลเยอร์ = ปรับขนาด) · P: ระบายสี · W: แสดงตาข่าย · X: สมมาตร · N: เลเยอร์ใหม่ · TAB: เลเยอร์ถัดไป · R: Remesh · E: ส่งไป Blender · Cmd+Z: เลิกทำ'],
  // Espejo y cámara externa
  'LA PLASTILINA · ESPEJO': ['LA PLASTILINA · MIRROR', 'LA PLASTILINA · กระจกสะท้อน'], 'Esperando a las gafas…': ['Waiting for the headset…', 'กำลังรอแว่น…'], 'En directo': ['Live', 'สด'],
  'Tus ojos': ['Your eyes', 'สายตาคุณ'], 'Cámara libre': ['Free camera', 'กล้องอิสระ'], 'Giro': ['Orbit', 'หมุนรอบ'], 'Webcam': ['Webcam', 'เว็บแคม'], 'Calibrar': ['Calibrate', 'ปรับเทียบ'], 'Mandos': ['Controllers', 'คอนโทรลเลอร์'],
  'Muestra los mandos virtuales para comprobar que encajan': ['Shows the virtual controllers to check they line up', 'แสดงคอนโทรลเลอร์เสมือนเพื่อตรวจว่าตรงกัน'], 'Retraso gafas': ['Headset delay', 'หน่วงเวลาแว่น'],
  'Flechas: girar · Mayús+flechas: mover · +/−: zoom (retoque fino de la cámara).': ['Arrows: rotate · Shift+arrows: move · +/−: zoom (fine camera adjustment).', 'ลูกศร: หมุน · Shift+ลูกศร: ย้าย · +/−: ซูม (ปรับกล้องละเอียด)'],
  'Fondo': ['Background', 'พื้นหลัง'], 'Fondo: {0}': ['Background: {0}', 'พื้นหลัง: {0}'], 'oscuro': ['dark', 'มืด'], 'croma': ['chroma', 'โครมา'], 'blanco': ['white', 'ขาว'], 'negro': ['black', 'ดำ'], 'Ocultar': ['Hide', 'ซ่อน'],
  '● Grabar': ['● Record', '● บันทึกวิดีโอ'], '■ Parar': ['■ Stop', '■ หยุด'], '■ Parar {0}': ['■ Stop {0}', '■ หยุด {0}'], 'Guardando…': ['Saving…', 'กำลังบันทึก…'], 'Micro': ['Mic', 'ไมค์'],
  '1/2/3/4 vista · F fondo (verde = croma) · M malla · R grabar · V formato · H ocultar/mostrar este panel.': ['1/2/3/4 view · F background (green = chroma) · M mesh · R record · V format · H hide/show this panel.', '1/2/3/4 มุมมอง · F พื้นหลัง (เขียว = โครมา) · M ตาข่าย · R บันทึกวิดีโอ · V รูปแบบ · H ซ่อน/แสดงแผงนี้'],
  'Las grabaciones se guardan en el Mac, en la carpeta': ['Recordings are saved on the Mac, in the folder', 'วิดีโอจะบันทึกใน Mac ในโฟลเดอร์'],
  'Repetir': ['Redo', 'ทำใหม่'], 'Usar esta calibración': ['Use this calibration', 'ใช้การปรับเทียบนี้'], 'Cancelar': ['Cancel', 'ยกเลิก'], 'Cámara {0}': ['Camera {0}', 'กล้อง {0}'],
  'No puedo abrir la cámara: {0}': ["Can't open the camera: {0}", 'เปิดกล้องไม่ได้: {0}'], 'Cámara lista. Pulsa "Calibrar" para encajar la escultura con el vídeo': ['Camera ready. Press "Calibrate" to line up the sculpture with the video', 'กล้องพร้อมแล้ว กด "ปรับเทียบ" เพื่อให้ประติมากรรมตรงกับวิดีโอ'],
  'Ponte las gafas (bien puestas, no en la frente) y coge los dos mandos.<br>Mueve las manos <b>despacio y delante de la webcam</b>: arriba, abajo, cerca, lejos, a los lados.<br>Los puntos verdes son tus manos detectadas.':
    ['Put on the headset (properly, not on your forehead) and take both controllers.<br>Move your hands <b>slowly in front of the webcam</b>: up, down, near, far, to the sides.<br>The green dots are your detected hands.',
     'สวมแว่นให้เรียบร้อย (ไม่ใช่ไว้บนหน้าผาก) แล้วถือคอนโทรลเลอร์ทั้งสองอัน<br>ขยับมือ<b>ช้าๆ ตรงหน้าเว็บแคม</b>: ขึ้น ลง ใกล้ ไกล ด้านข้าง<br>จุดสีเขียวคือมือที่ตรวจพบ'],
  'Mueve las manos despacio delante de la webcam': ['Move your hands slowly in front of the webcam', 'ขยับมือช้าๆ ตรงหน้าเว็บแคม'],
  'Sigue moviendo las manos': ['Keep moving your hands', 'ขยับมือต่อไป'],
  'No veo tus manos: ponlas delante de la webcam y con más luz': ['I cannot see your hands: put them in front of the webcam, with more light', 'มองไม่เห็นมือ: วางมือตรงหน้าเว็บแคมและเพิ่มแสง'],
  'Preparando la detección de manos…': ['Preparing hand detection…', 'กำลังเตรียมการตรวจจับมือ…'],
  'No se ha podido cargar la detección de manos: {0}': ['Could not load hand detection: {0}', 'โหลดการตรวจจับมือไม่ได้: {0}'],
  'Listo: mira el Mac': ['Done: look at the Mac', 'เสร็จแล้ว: ดูที่ Mac'],
  'Mira los mandos virtuales: ¿caen sobre los reales?': ['Look at the virtual controllers: do they land on the real ones?', 'ดูคอนโทรลเลอร์เสมือน: ตรงกับของจริงไหม?'],
  'Error: {0} px · lente {1}° · cámara a {2} m · retraso {3} ms': ['Error: {0} px · lens {1}° · camera at {2} m · delay {3} ms', 'คลาดเคลื่อน: {0} px · เลนส์ {1}° · กล้องห่าง {2} ม. · หน่วง {3} ms'],
  'No cuadra: hace falta más luz y mover más las manos delante de la cámara.': ['It does not fit: it needs more light and more hand movement in front of the camera.', 'ยังไม่ตรง: ต้องการแสงมากขึ้นและขยับมือตรงหน้ากล้องมากขึ้น'],
  'Puedes quedarte con la anterior, que es la que ves ahora.': ['You can keep the previous one, which is what you see now.', 'คุณเลือกใช้อันก่อนหน้าได้ ซึ่งคืออันที่เห็นอยู่ตอนนี้'],
  'Horizontal': ['Horizontal', 'แนวนอน'], 'Vertical (redes)': ['Vertical (social)', 'แนวตั้ง (โซเชียล)'], 'Encuadre': ['Framing', 'จัดเฟรม'],
  'No se puede cambiar el formato mientras grabas': ['You cannot change the format while recording', 'เปลี่ยนรูปแบบระหว่างบันทึกไม่ได้'],
  'Seguir casco': ['Follow headset', 'ติดตามแว่น'], 'El plano vertical te sigue': ['The vertical frame follows you', 'เฟรมแนวตั้งติดตามคุณ'],
  'Calibra la cámara para que el plano pueda seguir el casco': ['Calibrate the camera so the frame can follow the headset', 'ปรับเทียบกล้องเพื่อให้เฟรมติดตามแว่นได้'],
  '+ Mandos': ['+ Controllers', '+ คอนโทรลเลอร์'], 'El plano también sigue los mandos que estés moviendo': ['The frame also follows the controllers you are moving', 'เฟรมติดตามคอนโทรลเลอร์ที่คุณกำลังขยับด้วย'],
  'En el Mac, en obras/{0}: {1} capa(s) · {2} quads': ['On the Mac, in obras/{0}: {1} layer(s) · {2} quads', 'อยู่บน Mac ใน obras/{0}: {1} เลเยอร์ · {2} quads'],
  'Guardado en las gafas: irá al Mac cuando se conecte': ['Saved on the headset: it will go to the Mac when connected', 'บันทึกในแว่นแล้ว: จะส่งไป Mac เมื่อเชื่อมต่อ'],
  'Guardado: {0} (también en el Mac)': ['Saved: {0} (also on the Mac)', 'บันทึกแล้ว: {0} (อยู่บน Mac ด้วย)'],
  'Autoguardado': ['Autosave', 'บันทึกอัตโนมัติ'], 'Trayendo la obra del Mac…': ['Getting the work from the Mac…', 'กำลังดึงผลงานจาก Mac…'],
  'Esa obra está en el Mac y ahora no llego a él': ['That work is on the Mac and I cannot reach it now', 'ผลงานนั้นอยู่บน Mac และตอนนี้เชื่อมต่อไม่ได้'],
  'Cámara calibrada. Retoca con las flechas si hace falta': ['Camera calibrated. Fine-tune with the arrow keys if needed', 'ปรับเทียบกล้องแล้ว ใช้ปุ่มลูกศรปรับละเอียดได้ถ้าจำเป็น'],
  'No llegan los mandos de las gafas': ['The headset controllers are not arriving', 'ไม่ได้รับข้อมูลคอนโทรลเลอร์จากแว่น'], 'Calculando…': ['Calculating…', 'กำลังคำนวณ…'], 'Sin micro: se graba sin sonido': ['No mic: recording without sound', 'ไม่มีไมค์: บันทึกแบบไม่มีเสียง'], 'Grabación descargada: {0}': ['Recording downloaded: {0}', 'ดาวน์โหลดวิดีโอแล้ว: {0}'], 'Grabación guardada en {0}': ['Recording saved in {0}', 'บันทึกวิดีโอไว้ที่ {0}'],
};

const norm = (s) => s.replace(/\s+/g, ' ').trim();

export function getLang() { return lang; }

export function t(s, ...args) {
  const row = lang === 'es' ? null : D[s];
  let out = row ? row[lang === 'en' ? 0 : 1] : s;
  args.forEach((a, i) => { out = out.replaceAll(`{${i}}`, a); });
  return out;
}

// Textos fijos del HTML: cada nodo recuerda su texto original en español.
const originals = new WeakMap();
export function translateDOM(root = document.body) {
  const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = walk.nextNode(); n; n = walk.nextNode()) {
    const cur = norm(n.nodeValue);
    if (!cur) continue;
    let es = originals.get(n);
    if (es === undefined || (es.out !== n.nodeValue)) es = { src: cur, out: n.nodeValue };
    if (!(es.src in D)) continue;
    const pad = n.nodeValue.match(/^\s*/)[0], tail = n.nodeValue.match(/\s*$/)[0];
    n.nodeValue = pad + t(es.src) + tail;
    es.out = n.nodeValue;
    originals.set(n, es);
  }
  root.querySelectorAll('[title]').forEach((el) => {
    const es = el.dataset.titleEs || el.title;
    if (!(es in D)) return;
    el.dataset.titleEs = es;
    el.title = t(es);
  });
  document.documentElement.lang = lang;
}

// Cambia de idioma; onDone redibuja lo que se pinta en lienzos (cuando la letra ya está cargada).
export async function setLang(l, onDone) {
  if (!LANGS.includes(l)) return;
  lang = l;
  try { localStorage.setItem('plastilinaLang', l); } catch {}
  translateDOM();
  await readyFont();
  onDone?.();
}

// La letra tailandesa va con la app (funciona sin internet y en cualquier casco).
export async function readyFont() {
  if (lang !== 'th') return;
  try { await document.fonts.load('700 30px "Noto Sans Thai"', 'ก'); await document.fonts.load('500 30px "Noto Sans Thai"', 'ก'); } catch {}
}
