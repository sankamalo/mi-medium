// Idiomas de la app: español (el texto original), inglés y tailandés.
// t('Guardar') busca la traducción; lo que no está en el diccionario se queda tal cual
// (nombres de capas, números…). {0}, {1} = valores que se insertan en la frase.

const LANGS = ['es', 'en', 'th'];
let lang = 'es';
try { const s = localStorage.getItem('plastilinaLang'); if (LANGS.includes(s)) lang = s; } catch {}

// español: [inglés, tailandés]
const D = {
  // Tutorial y sonidos
  '▶ Jugar tutorial': ['▶ Play tutorial', '▶ เล่นบทเรียน'], 'Saltar paso': ['Skip step', 'ข้ามขั้นนี้'], 'Salir del tutorial': ['Exit tutorial', 'ออกจากบทเรียน'],
  'Espera a que acaben de unirse las capas': ['Wait for the layers to finish merging', 'รอให้รวมเลเยอร์เสร็จก่อน'], 'Ha cambiado una capa: unión cancelada': ['A layer changed: merge cancelled', 'เลเยอร์เปลี่ยน ยกเลิกการรวมแล้ว'], 'Uniendo capas': ['Merging layers', 'กำลังรวมเลเยอร์'], 'Unir capas': ['Merge layers', 'รวมเลเยอร์'], 'Esto quedaría muy pesado: unos {0} polígonos. ¿Reducirlo antes de unir?': ['This would be very heavy: about {0} polygons. Reduce it before merging?', 'จะหนักมาก ประมาณ {0} โพลิกอน ลดก่อนรวมไหม'], 'Sin reducir: {0}³ · unos {1} polígonos': ['Don’t reduce: {0}³ · about {1} polygons', 'ไม่ลด: {0}³ · ประมาณ {1} โพลิกอน'], '{0}³ · unos {1} polígonos': ['{0}³ · about {1} polygons', '{0}³ · ประมาณ {1} โพลิกอน'], '{0}³ · unos {1} polígonos · recomendado': ['{0}³ · about {1} polygons · recommended', '{0}³ · ประมาณ {1} โพลิกอน · แนะนำ'], 'Reducir quita detalle fino. Se puede deshacer.': ['Reducing removes fine detail. It can be undone.', 'การลดจะทำให้รายละเอียดเล็กๆ หายไป ย้อนกลับได้'],
  'Presión': ['Pressure', 'แรงกด'], 'Presión: Añadir engorda según aprietas el gatillo': ['Pressure: Add gets thicker the harder you press the trigger', 'แรงกด: ยิ่งกดไกแรง เพิ่มยิ่งหนา'], 'Sin presión: Añadir siempre del mismo grosor': ['No pressure: Add always has the same thickness', 'ไม่ใช้แรงกด: เพิ่มหนาเท่ากันเสมอ'], 'Espera a que acabe la barra': ['Wait for the bar to finish', 'รอให้แถบเสร็จก่อน'], 'Ha cambiado la capa: cancelado': ['The layer changed: cancelled', 'เลเยอร์เปลี่ยน ยกเลิกแล้ว'], 'Cambiando resolución': ['Changing resolution', 'กำลังเปลี่ยนความละเอียด'], '{0}: ahora a {1}³': ['{0}: now at {1}³', '{0}: ตอนนี้ {1}³'], 'Las capas con fotogramas no cambian de resolución': ['Layers with frames can’t change resolution', 'เลเยอร์ที่มีเฟรมเปลี่ยนความละเอียดไม่ได้'], 'A {0}³ quedaría muy pesado: unos {1} polígonos.': ['At {0}³ it would be very heavy: about {1} polygons.', 'ที่ {0}³ จะหนักมาก ประมาณ {1} โพลิกอน'], 'Subir a {0}³': ['Go up to {0}³', 'เพิ่มเป็น {0}³'], 'Se puede deshacer.': ['It can be undone.', 'ย้อนกลับได้'],
  'Texto': ['Text', 'ข้อความ'], 'Boceto de texto': ['Text sketch', 'ร่างข้อความ'], 'Escribe en mayúsculas, con las letras separadas': ['Write in capitals, with separate letters', 'เขียนตัวพิมพ์ใหญ่ แยกตัวอักษร'], 'Escribe algo primero': ['Write something first', 'เขียนอะไรก่อน'], 'Leyendo tus letras': ['Reading your letters', 'กำลังอ่านตัวอักษร'], 'He leído: {0}. Toca una letra para corregirla': ['I read: {0}. Tap a letter to fix it', 'อ่านได้: {0} แตะตัวอักษรเพื่อแก้'], 'Está en vóxel: pulsa «A quads» para cambiar las letras': ['It’s in voxel: press “To quads” to change the letters', 'เป็นวอกเซลอยู่ กด “เป็นควอด” เพื่อแก้ตัวอักษร'], 'Pasando a vóxel': ['Converting to voxel', 'กำลังแปลงเป็นวอกเซล'], 'Otra vez en quads, limpio': ['Back to clean quads', 'กลับเป็นควอดแล้ว'], 'Escribe con Añadir, en mayúsculas y con las letras separadas. O usa el teclado.': ['Write with Add, in capitals with separate letters. Or use the keyboard.', 'เขียนด้วยเพิ่ม ตัวพิมพ์ใหญ่ แยกตัวอักษร หรือใช้แป้นพิมพ์'], 'Convertir en texto': ['Turn into text', 'แปลงเป็นข้อความ'], 'Borrar': ['Clear', 'ล้าง'], '{0} trazos': ['{0} strokes', '{0} เส้น'], 'Aún no hay trazos': ['No strokes yet', 'ยังไม่มีเส้น'], '¿Era otra?': ['Another one?', 'ตัวอื่นไหม'], 'Grosor': ['Depth', 'ความหนา'], 'Altura': ['Height', 'ความสูง'], 'A quads': ['To quads', 'เป็นควอด'], 'Escribir otro': ['Write another', 'เขียนอีก'], '{0} quads': ['{0} quads', '{0} ควอด'], 'En vóxel': ['In voxel', 'เป็นวอกเซล'],
  'Formas': ['Shapes', 'รูปทรง'], 'Caja': ['Box', 'กล่อง'], 'Pirámide': ['Pyramid', 'พีระมิด'], 'Cuña': ['Wedge', 'ลิ่ม'], 'A forma': ['To shape', 'เป็นรูปทรง'], 'Como al principio': ['Reset', 'เริ่มใหม่'], 'Otra vez en forma, limpia': ['Back to the clean shape', 'กลับเป็นรูปทรงแล้ว'], '{0}: coge las esquinas, aristas o caras con el gatillo': ['{0}: grab the corners, edges or faces with the trigger', '{0}: จับมุม ขอบ หรือหน้าด้วยไก'], '{0}: {1} caras': ['{0}: {1} faces', '{0}: {1} หน้า'], '{0}: en vóxel': ['{0}: in voxel', '{0}: เป็นวอกเซล'], 'Con la mínima geometría: una caja son 6 caras.': ['With minimal geometry: a box is 6 faces.', 'เรขาคณิตน้อยที่สุด กล่องมี 6 หน้า'], 'Coge con el gatillo: amarillo = esquina, azul = arista, rojo = cara.': ['Grab with the trigger: yellow = corner, blue = edge, red = face.', 'จับด้วยไก: เหลือง = มุม น้ำเงิน = ขอบ แดง = หน้า'], 'Con Mover la llevas, giras y escalas entera.': ['With Move you carry, turn and scale it whole.', 'ใช้ย้ายเพื่อถือ หมุน และย่อขยายทั้งชิ้น'], '«A vóxel» la convierte en plastilina; «A forma» vuelve a la forma limpia.': ['“To voxel” turns it into clay; “To shape” goes back to the clean shape.', '“เป็นวอกเซล” เปลี่ยนเป็นดินน้ำมัน “เป็นรูปทรง” กลับเป็นรูปทรงเดิม'],
  'Sonidos': ['Sounds', 'เสียง'], 'El próximo trazo de Añadir irá a {0}³, en otra capa': ['The next Add stroke will be {0}³, on another layer', 'เส้นเพิ่มถัดไปจะเป็น {0}³ ในอีกเลเยอร์'], '{0}: capa nueva a {1}³': ['{0}: new layer at {1}³', '{0}: เลเยอร์ใหม่ {1}³'], 'Toca el círculo de color de dos capas o más': ['Tap the color circle of two or more layers', 'แตะวงกลมสีของอย่างน้อยสองเลเยอร์'], 'Las capas con fotogramas no se pueden unir': ['Layers with frames can’t be merged', 'เลเยอร์ที่มีเฟรมรวมกันไม่ได้'], 'Espera a que acabe el remesh': ['Wait for the remesh to finish', 'รอให้ remesh เสร็จก่อน'], 'Uniendo {0} capas…': ['Merging {0} layers…', 'กำลังรวม {0} เลเยอร์…'], 'Capas unidas en {0}, a {1}³': ['Layers merged into {0}, at {1}³', 'รวมเลเยอร์เป็น {0} ที่ {1}³'], 'Unir {0} capas': ['Merge {0} layers', 'รวม {0} เลเยอร์'], 'Toca los círculos para unir': ['Tap the circles to merge', 'แตะวงกลมเพื่อรวม'], 'Elegir para unir': ['Pick to merge', 'เลือกเพื่อรวม'], 'Sensible': ['Sensitive', 'ไวต่อแรงกด'], 'Añadir engorda según aprietas el gatillo': ['Add gets thicker the harder you press the trigger', 'ยิ่งกดไกแรง เพิ่มยิ่งหนา'], 'Añadir siempre del mismo grosor': ['Add always has the same thickness', 'เพิ่มหนาเท่ากันเสมอ'], 'La cámara no da imagen': ['The camera gives no picture', 'กล้องไม่มีภาพ'], 'Hoja encontrada': ['Sheet found', 'เจอกระดาษแล้ว'], 'Pon la hoja delante, sobre fondo oscuro': ['Hold the sheet in front, on a dark background', 'ถือกระดาษไว้ด้านหน้า บนพื้นหลังสีเข้ม'], 'La cámara da negro dentro de VR: sal de VR y saca la foto desde ahí': ['The camera is black inside VR: exit VR and take the photo from there', 'กล้องเป็นสีดำใน VR ออกจาก VR แล้วถ่ายจากตรงนั้น'], 'La cámara da negro: revisa el permiso de la cámara': ['The camera is black: check the camera permission', 'กล้องเป็นสีดำ ตรวจสอบสิทธิ์กล้อง'], 'No vi la hoja, va la foto entera. Coge la bola azul para colocarla': ['Sheet not found, using the whole photo. Grab the blue ball to place it', 'ไม่เจอกระดาษ ใช้ทั้งภาพ จับลูกบอลสีฟ้าเพื่อวาง'], 'Sonido': ['Sound', 'เสียง'], 'Sonido ▸': ['Sound ▸', 'เสียง ▸'], 'Llamada': ['Call', 'สาย'], 'Llamada ▸': ['Call ▸', 'สาย ▸'], 'Ver llamada': ['Show call', 'ดูสาย'], 'Apagada': ['Off', 'ปิด'], 'Esperando al Mac…': ['Waiting for the Mac…', 'รอ Mac…'], 'Conectando…': ['Connecting…', 'กำลังเชื่อมต่อ…'], 'Conectada': ['Connected', 'เชื่อมต่อแล้ว'], 'sin Mac': ['no Mac', 'ไม่พบ Mac'], 'En el Mac abre Llamada VR y elige la ventana de Discord. Las gafas y el Mac deben estar en la misma Wi-Fi.': ['On the Mac, open Llamada VR and choose the Discord window. The headset and the Mac must be on the same Wi-Fi.', 'บน Mac เปิด Llamada VR แล้วเลือกหน้าต่าง Discord แว่นและ Mac ต้องอยู่ใน Wi-Fi เดียวกัน'], 'Solo llega la imagen: la voz sigue sonando en el Mac o en el móvil.': ['Only the picture comes through: the voice stays on the Mac or the phone.', 'ส่งมาแค่ภาพ เสียงยังอยู่ที่ Mac หรือมือถือ'], 'Resolución': ['Resolution', 'ความละเอียด'], 'Velocidad del torno': ['Lathe speed', 'ความเร็วแป้นหมุน'], 'A vóxel': ['To voxel', 'เป็นวอกเซล'], '{0} tiene remesh: pulsa «A vóxel» para esculpirla': ['{0} is remeshed: press “To voxel” to sculpt it', '{0} ทำ remesh แล้ว กด “เป็นวอกเซล” เพื่อปั้นต่อ'], '{0}: otra vez en vóxel': ['{0}: back to voxel', '{0}: กลับเป็นวอกเซลแล้ว'], 'Sonido de Añadir': ['Add sound', 'เสียงตอนเพิ่ม'], 'Slime': ['Slime', 'สไลม์'], 'Goma': ['Rubber', 'ยาง'], 'Perlitas': ['Beads', 'ลูกปัด'], 'Ronroneo': ['Purr', 'แมวคราง'], 'TU PRIMER TOMATE': ['YOUR FIRST TOMATO', 'มะเขือเทศลูกแรกของคุณ'],
  '¡Tomate terminado! Ya sabes jugar.': ['Tomato done! Now you know how to play.', 'มะเขือเทศเสร็จแล้ว! ตอนนี้คุณเล่นเป็นแล้ว'],
  'Mantén el gatillo y pasa la punta por la bola para añadirle barro.': ['Hold the trigger and run the tip over the ball to add clay.', 'กดไกค้างไว้ แล้วลากปลายผ่านลูกบอลเพื่อเติมดิน'],
  'Mantén el clic izquierdo y pasa por la bola para añadirle barro.': ['Hold left click and move over the ball to add clay.', 'กดคลิกซ้ายค้างไว้ แล้วลากผ่านลูกบอลเพื่อเติมดิน'],
  'Clic en el stick derecho: se abre la flor. Deja la punta sobre Inflar.': ['Click the right stick to open the flower. Rest the tip on Inflate.', 'คลิกสติกขวาเพื่อเปิดดอกไม้ แล้ววางปลายไว้ที่ พอง'],
  'Clic derecho: se abre el dial de herramientas. Elige Inflar.': ['Right click opens the tool dial. Choose Inflate.', 'คลิกขวาเพื่อเปิดวงล้อเครื่องมือ แล้วเลือก พอง'],
  'Aprieta el gatillo sobre la bola y hazla gorda como un tomate.': ['Squeeze the trigger on the ball and make it fat like a tomato.', 'กดไกบนลูกบอลให้พองอ้วนเหมือนมะเขือเทศ'],
  'Mantén el clic sobre la bola y hazla gorda como un tomate.': ['Hold click on the ball and make it fat like a tomato.', 'กดคลิกค้างบนลูกบอลให้พองอ้วนเหมือนมะเขือเทศ'],
  'Abre la flor otra vez y deja la punta sobre Pintar.': ['Open the flower again and rest the tip on Paint.', 'เปิดดอกไม้อีกครั้ง แล้ววางปลายไว้ที่ ระบายสี'],
  'Abre el dial otra vez y elige Pintar.': ['Open the dial again and choose Paint.', 'เปิดวงล้ออีกครั้ง แล้วเลือก ระบายสี'],
  'Píntalo de rojo con el gatillo.': ['Paint it red with the trigger.', 'ใช้ไกระบายให้เป็นสีแดง'],
  'Píntalo de rojo pasando por encima.': ['Paint it red by moving over it.', 'ลากผ่านเพื่อระบายให้เป็นสีแดง'],
  '¿Te has pasado? Pulsa Y en el mando izquierdo para deshacer.': ['Went too far? Press Y on the left controller to undo.', 'ทำเกินไปไหม? กด Y ที่คอนโทรลเลอร์ซ้ายเพื่อย้อนกลับ'],
  '¿Te has pasado? Pulsa Cmd+Z para deshacer.': ['Went too far? Press Cmd+Z to undo.', 'ทำเกินไปไหม? กด Cmd+Z เพื่อย้อนกลับ'],
  'Empuja el stick izquierdo a la derecha y lo recuperas.': ['Push the left stick right to get it back.', 'ดันสติกซ้ายไปทางขวาเพื่อเอากลับมา'],
  'Pulsa Cmd+Mayús+Z y lo recuperas.': ['Press Cmd+Shift+Z to get it back.', 'กด Cmd+Shift+Z เพื่อเอากลับมา'],
  'Mantén un botón lateral del mando: mueve y gira tu tomate.': ['Hold a side button on the controller: move and turn your tomato.', 'กดปุ่มข้างคอนโทรลเลอร์ค้างไว้ เพื่อขยับและหมุนมะเขือเทศ'],
  'Arrastra fuera del tomate para darle la vuelta.': ['Drag outside the tomato to turn it around.', 'ลากด้านนอกมะเขือเทศเพื่อหมุน'],
  // Herramientas
  'Material': ['Material', 'วัสดุ'], 'Material ▸': ['Material ▸', 'วัสดุ ▸'], 'Rugosidad': ['Roughness', 'ความหยาบ'], 'Translucidez': ['Translucency', 'ความโปร่งแสง'], 'Brillo': ['Shine', 'ความเงา'],
  'Traer aquí': ['Bring here', 'นำมาที่นี่'], 'Volver a la plastilina normal': ['Back to normal clay', 'กลับเป็นดินน้ำมันปกติ'],
  'Has llegado al final del espacio de esta capa': ['You reached the end of this layer\'s space', 'ถึงขอบพื้นที่ของเลเยอร์นี้แล้ว'],
  'Esta capa ocupa demasiado para subir la resolución': ['This layer is too big to raise its resolution', 'เลเยอร์นี้ใหญ่เกินกว่าจะเพิ่มความละเอียด'],
  'Suelo': ['Floor', 'พื้น'], 'Centrar': ['Center', 'จัดกึ่งกลาง'],
  'Coge la bola amarilla con el gatillo para colocar la simetría': ['Grab the yellow ball with the trigger to place the symmetry', 'จับลูกบอลสีเหลืองด้วยไกเพื่อวางแนวสมมาตร'],
  'Arrastra la bola amarilla para colocar la simetría (Shift = girar)': ['Drag the yellow ball to place the symmetry (Shift = rotate)', 'ลากลูกบอลสีเหลืองเพื่อวางแนวสมมาตร (Shift = หมุน)'],
  'Simetría: coge la bola amarilla con el gatillo para moverla y girarla.': ['Symmetry: grab the yellow ball with the trigger to move and rotate it.', 'สมมาตร: จับลูกบอลสีเหลืองด้วยไกเพื่อย้ายและหมุน'],
  'Aplan.': ['Flat', 'แบน'], 'Pellizcar': ['Pinch', 'บีบ'], 'Pellizc.': ['Pinch', 'บีบ'], 'Hendidura': ['Crease', 'ทำร่อง'], 'Hend.': ['Crease', 'ร่อง'], 'Arrast.': ['Drag', 'ลาก'],
  'Simetría Y': ['Symmetry Y', 'สมมาตร Y'], 'Simetría Z': ['Symmetry Z', 'สมมาตร Z'], 'Radial': ['Radial', 'รัศมี'],
  'Pincel': ['Brush', 'พู่กัน'], 'Pincel ▸': ['Brush ▸', 'พู่กัน ▸'], 'FORMA': ['SHAPE', 'รูปทรง'], 'BORDE': ['EDGE', 'ขอบ'], 'TEXTURA': ['TEXTURE', 'พื้นผิว'], 'TRAZO': ['STROKE', 'เส้น'], 'SIMETRÍA': ['SYMMETRY', 'สมมาตร'], 'COPIAS DE LA RADIAL': ['RADIAL COPIES', 'จำนวนสำเนา'],
  'Borde': ['Edge', 'ขอบ'], 'Textura': ['Texture', 'พื้นผิว'], 'Trazo': ['Stroke', 'เส้น'],
  'Suave': ['Soft', 'นุ่ม'], 'Normal': ['Normal', 'ปกติ'], 'Duro': ['Hard', 'แข็ง'],
  'Torno': ['Potter\'s wheel', 'แป้นหมุน'], 'Velocidad': ['Speed', 'ความเร็ว'], 'TORNO': ['WHEEL', 'แป้นหมุน'], 'Girar': ['Spin', 'หมุน'], 'Torno: deja la mano quieta y la pieza se forma al girar. Mueve el eje con la bola amarilla.': ['Wheel: hold your hand still and the piece forms as it spins. Move the axis with the yellow ball.', 'แป้นหมุน: ถือมือนิ่งแล้วชิ้นงานจะขึ้นรูปเมื่อหมุน ย้ายแกนด้วยลูกบอลสีเหลือง'],
  'Importar': ['Import', 'นำเข้า'], 'Importar ▸': ['Import ▸', 'นำเข้า ▸'], 'Referencia': ['Reference', 'แบบอ้างอิง'], 'Tamaño de la referencia': ['Reference size', 'ขนาดแบบอ้างอิง'], 'Transparencia': ['Transparency', 'ความโปร่งใส'], 'Ocultar': ['Hide', 'ซ่อน'], 'Mostrar': ['Show', 'แสดง'], 'Quitar de la lista': ['Remove from list', 'เอาออกจากรายการ'], 'Aún no hay modelos. Importa uno fuera de VR, o déjalo en la carpeta referencias del Mac.': ['No models yet. Import one outside VR, or put it in the referencias folder on the Mac.', 'ยังไม่มีโมเดล นำเข้าเมื่ออยู่นอก VR หรือวางในโฟลเดอร์ referencias บน Mac'], 'Coge la bola azul con el gatillo para colocarla.': ['Grab the blue ball with the trigger to place it.', 'จับลูกบอลสีน้ำเงินด้วยไกเพื่อวาง'], 'Solo se usa para mirar: no se esculpe ni se exporta.': ['For looking only: it is not sculpted or exported.', 'ใช้ดูเท่านั้น ไม่ถูกปั้นหรือส่งออก'], 'No he podido abrir {0}': ['Could not open {0}', 'เปิด {0} ไม่ได้'], 'Solo FBX, OBJ o GLB': ['FBX, OBJ or GLB only', 'เฉพาะ FBX, OBJ หรือ GLB'], 'Este modelo es muy pesado: puede ir lento en las gafas': ['This model is very heavy: it may run slowly on the headset', 'โมเดลนี้หนักมาก อาจช้าบนแว่น'],
  'Solo FBX, OBJ, GLB o imágenes': ['Only FBX, OBJ, GLB or images', 'เฉพาะ FBX, OBJ, GLB หรือรูปภาพ'], 'Sacar foto': ['Take photo', 'ถ่ายรูป'], 'Foto en {0}…': ['Photo in {0}…', 'ถ่ายใน {0}…'], 'Foto lista: coge la bola azul para colocarla': ['Photo ready: grab the blue ball to place it', 'รูปพร้อมแล้ว: จับลูกบอลสีน้ำเงินเพื่อวาง'], 'Este navegador no deja usar la cámara': ['This browser does not allow the camera', 'เบราว์เซอร์นี้ไม่อนุญาตให้ใช้กล้อง'], 'No puedo usar la cámara aquí: sal de VR, pulsa Sacar foto y acepta el permiso': ['Can\'t use the camera here: leave VR, press Take photo and accept', 'ใช้กล้องที่นี่ไม่ได้: ออกจาก VR กดถ่ายรูปแล้วอนุญาต'],
  'Exportar': ['Export', 'ส่งออก'], 'Exportar ▸': ['Export ▸', 'ส่งออก ▸'], 'Quads al exportar': ['Quads when exporting', 'จำนวนควอดตอนส่งออก'], 'Sin cambiar': ['Unchanged', 'ไม่เปลี่ยน'], 'Ahora: {0} quads': ['Now: {0} quads', 'ตอนนี้: {0} ควอด'], 'Compartir': ['Share', 'แชร์'], 'Fondo': ['Background', 'พื้นหลัง'], 'Fondo ▸': ['Background ▸', 'พื้นหลัง ▸'], 'Oscuro': ['Dark', 'มืด'], 'Gris': ['Gray', 'เทา'], 'Crema': ['Cream', 'ครีม'], 'Azul noche': ['Night blue', 'น้ำเงินเข้ม'], 'Estudio': ['Studio', 'สตูดิโอ'], 'Atardecer': ['Sunset', 'พระอาทิตย์ตก'], 'Cielo': ['Sky', 'ท้องฟ้า'], 'Bosque': ['Forest', 'ป่า'], 'Color plano': ['Flat color', 'สีเรียบ'], 'Luz de un lugar real': ['Light from a real place', 'แสงจากสถานที่จริง'], 'Girar la luz': ['Rotate the light', 'หมุนแสง'], 'Cuánto se ve el fondo': ['How visible the background is', 'ความชัดของพื้นหลัง'], 'No he podido cargar el fondo': ['Could not load the background', 'โหลดพื้นหลังไม่ได้'], 'Rehaciendo la malla…': ['Rebuilding the mesh…', 'กำลังสร้างเมชใหม่…'],
  '{0} copia': ['{0} copy', '{0} สำเนา'], '{0} creada': ['{0} created', 'สร้าง {0} แล้ว'], '− Capa': ['− Layer', '− เลเยอร์'], '¿Seguro?': ['Sure?', 'แน่ใจไหม?'],
  'Animación': ['Animation', 'แอนิเมชัน'], 'La animación ya pesa mucho: guarda la obra a menudo': ['The animation is getting heavy: save often', 'แอนิเมชันเริ่มหนักแล้ว: บันทึกบ่อย ๆ'], 'Animar ▸': ['Animate ▸', 'แอนิเมต ▸'], 'Fotograma {0} de {1}': ['Frame {0} of {1}', 'เฟรม {0} จาก {1}'], '{0} fot.': ['{0} fr.', '{0} เฟรม'], 'Play': ['Play', 'เล่น'], 'Pausa': ['Pause', 'หยุด'], '+ Copia': ['+ Copy', '+ คัดลอก'], '+ Vacío': ['+ Empty', '+ ว่าง'], 'Borrar fot.': ['Delete fr.', 'ลบเฟรม'], 'Piel de cebolla': ['Onion skin', 'เงาเฟรม'], 'Velocidad (fotogramas por segundo)': ['Speed (frames per second)', 'ความเร็ว (เฟรมต่อวินาที)'], 'Rojo = antes · Azul = después': ['Red = before · Blue = after', 'แดง = ก่อน · น้ำเงิน = หลัง'], 'Stick derecho ←/→: cambia de fotograma': ['Right stick ←/→: change frame', 'สติกขวา ←/→: เปลี่ยนเฟรม'], 'Al final, → crea una copia · B = play': ['At the end, → makes a copy · B = play', 'เฟรมสุดท้าย → สร้างสำเนา · B = เล่น'], 'Añade más fotogramas para poder reproducir': ['Add more frames to play', 'เพิ่มเฟรมก่อนจึงจะเล่นได้'], 'No puedes borrar el único fotograma': ['You can\'t delete the only frame', 'ลบเฟรมเดียวที่มีไม่ได้'], 'Las capas con fotogramas no se pueden hacer remesh': ['Layers with frames can\'t be remeshed', 'เลเยอร์ที่มีเฟรมรีเมชไม่ได้'],
  'Sellos': ['Stamps', 'ตราปั๊ม'], 'Guardar mi capa como sello': ['Save my layer as a stamp', 'บันทึกเลเยอร์เป็นตราปั๊ม'], 'Mi sello {0}': ['My stamp {0}', 'ตราปั๊มของฉัน {0}'], 'Sello guardado': ['Stamp saved', 'บันทึกตราปั๊มแล้ว'], 'Esta capa está vacía': ['This layer is empty', 'เลเยอร์นี้ว่างเปล่า'], 'Borrar mi último sello': ['Delete my last stamp', 'ลบตราปั๊มล่าสุด'], 'Sellos: pulsa una vez y queda puesto. El tamaño es el del pincel.': ['Stamps: press once and it stays. The size is the brush size.', 'ตราปั๊ม: กดครั้งเดียวก็ติด ขนาดเท่ากับพู่กัน'],
  'Ojo': ['Eye', 'ตา'], 'Ojo dormido': ['Sleepy eye', 'ตาง่วง'], 'Sonrisa': ['Smile', 'รอยยิ้ม'], 'Boca abierta': ['Open mouth', 'ปากอ้า'], 'Gato': ['Cat', 'แมว'], 'Conejo': ['Rabbit', 'กระต่าย'], 'Pez': ['Fish', 'ปลา'], 'Pájaro': ['Bird', 'นก'], 'Piedra': ['Stone', 'หิน'], 'Seta': ['Mushroom', 'เห็ด'], 'Flor': ['Flower', 'ดอกไม้'], 'Corazón': ['Heart', 'หัวใจ'],
  'Palillo': ['Toothpick', 'ไม้จิ้มฟัน'], 'Cúter': ['Cutter', 'คัตเตอร์'], 'Cuchara': ['Spoon', 'ช้อน'], 'Dedo mojado': ['Wet finger', 'นิ้วเปียก'], 'Rodillo': ['Rolling pin', 'ไม้นวด'], 'Espátula': ['Spatula', 'เกรียง'], 'Rueda de color': ['Color wheel', 'วงล้อสี'],
  'Liso': ['Plain', 'เรียบ'], 'Rugoso': ['Rough', 'ขรุขระ'], 'Puntos': ['Dots', 'จุด'], 'Rayas': ['Stripes', 'ลาย'], 'Escamas': ['Scales', 'เกล็ด'],
  'Libre': ['Free', 'อิสระ'], 'Recto': ['Straight', 'ตรง'],
  'Textura: en Añadir, Quitar, Inflar y Pintar.': ['Texture: on Add, Remove, Inflate and Paint.', 'พื้นผิว: ใช้กับ เพิ่ม ลบออก ทำให้พอง และระบายสี'],
  'Trazo recto: aprieta en el inicio, suelta en el final.': ['Straight stroke: press at the start, release at the end.', 'เส้นตรง: กดที่จุดเริ่ม ปล่อยที่จุดจบ'],
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
  'Textura en todas': ['Texture on all tools', 'ใช้ลายกับทุกเครื่องมือ'], 'Ver la sala': ['Show the room', 'ดูห้องจริง'],
  'Técnico': ['Technical', 'เทคนิค'], 'Color y capas': ['Color & layers', 'สีและเลเยอร์'], 'Obra': ['Work', 'ผลงาน'], 'Fijar': ['Pin', 'ตรึง'], 'A la mano': ['To hand', 'กลับมาที่มือ'],
  'Tira de una esquina amarilla con el mando derecho para dejar el panel donde quieras.': ['Pull a yellow corner with the right controller to leave the panel wherever you like.', 'ดึงมุมสีเหลืองด้วยคอนโทรลเลอร์ขวาเพื่อวางแผงไว้ตรงไหนก็ได้'],
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
  'Clic izq. sobre el modelo: esculpir · Clic izq. fuera: girar · Clic der.: dial de herramientas · Botón central: mover vista · Rueda: zoom · SHIFT: suavizar · CTRL: invertir · ALT+clic: coger color · [ ]: tamaño · 1–9 y 0: herramientas (8 = arrastrar) · B: forma del pincel · G: mover capa (arrastra · Shift+arrastra = girar · rueda sobre la capa = escalar) · P: pintar · W: ver malla · X: simetría · N: nueva capa · TAB: siguiente capa · R: remesh · E: a Blender · Cmd+Z: deshacer · , y .: fotograma · O: reproducir':
    ['Left click on the model: sculpt · Left click outside: orbit · Right click: tool dial · Middle button: pan · Wheel: zoom · SHIFT: smooth · CTRL: invert · ALT+click: pick color · [ ]: size · 1–9, 0: tools (8 = drag) · B: brush shape · G: move layer (drag · Shift+drag = rotate · wheel on the layer = scale) · P: paint · W: show mesh · X: symmetry · N: new layer · TAB: next layer · R: remesh · E: to Blender · Cmd+Z: undo · , and .: frame · O: play',
      'คลิกซ้ายบนโมเดล: ปั้น · คลิกซ้ายด้านนอก: หมุน · คลิกขวา: วงเครื่องมือ · ปุ่มกลาง: เลื่อนมุมมอง · ลูกกลิ้ง: ซูม · SHIFT: ทำให้เรียบ · CTRL: กลับด้าน · ALT+คลิก: เลือกสี · [ ]: ขนาด · 1–9, 0: เครื่องมือ (8 = ลาก) · B: รูปทรงแปรง · G: ย้ายเลเยอร์ (ลาก · Shift+ลาก = หมุน · ลูกกลิ้งบนเลเยอร์ = ปรับขนาด) · P: ระบายสี · W: แสดงตาข่าย · X: สมมาตร · N: เลเยอร์ใหม่ · TAB: เลเยอร์ถัดไป · R: Remesh · E: ส่งไป Blender · Cmd+Z: เลิกทำ · , และ .: เฟรม · O: เล่น'],
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
