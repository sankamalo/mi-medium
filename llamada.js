// Ver una ventana del Mac (la cámara de Discord) dentro de las gafas. Discord no deja sacar su vídeo,
// así que el Mac captura la ventana y la manda directa a las gafas por WebRTC, dentro de la misma Wi-Fi:
// el servidor del Mac solo presenta a los dos, el vídeo no pasa por internet ni se guarda en ningún sitio.

const ID = Math.random().toString(36).slice(2, 10);

// El aviso de conexión se manda entero, cuando ya se sabe por dónde llegar.
function ready(pc) {
  return new Promise((done) => {
    if (pc.iceGatheringState === 'complete') return done();
    pc.addEventListener('icegatheringstatechange', () => pc.iceGatheringState === 'complete' && done());
    setTimeout(done, 2500);
  });
}

// El Mac: manda lo que se comparte a quien lo pida.
export class Emisor {
  constructor(hub, onChange) {
    this.hub = hub;
    this.onChange = onChange;
    this.stream = null;
    this.pc = null;
    this.peer = null;
    this.answered = false;
    this.sentAt = 0;
  }
  get state() {
    if (!this.stream) return 'off';
    return this.pc?.connectionState === 'connected' ? 'connected' : 'waiting';
  }
  start(stream) {
    this.stream = stream;
    stream.getVideoTracks().forEach((tr) => {
      tr.contentHint = 'motion';
      tr.addEventListener('ended', () => this.stop());
    });
    this.onChange();
    if (this.peer) this.offer(this.peer);
  }
  stop() {
    this.stream?.getTracks().forEach((tr) => tr.stop());
    this.stream = null;
    this.pc?.close();
    this.pc = null;
    this.hub.send({ t: 'rtc', kind: 'bye', to: this.peer });
    this.onChange();
  }
  async offer(peer) {
    if (this.offering) return;
    this.offering = true;
    this.pc?.close();
    const pc = (this.pc = new RTCPeerConnection({ iceServers: [] }));
    this.peer = peer;
    this.answered = false;
    pc.addEventListener('connectionstatechange', () => this.onChange());
    this.stream.getTracks().forEach((tr) => pc.addTrack(tr, this.stream));
    await pc.setLocalDescription(await pc.createOffer());
    await ready(pc);
    this.offering = false;
    if (this.pc !== pc) return;
    this.sentAt = performance.now();
    this.hub.send({ t: 'rtc', kind: 'offer', from: ID, to: peer, sdp: pc.localDescription.sdp });
    this.onChange();
  }
  signal(m) {
    if (m.kind === 'hello') {
      const other = m.from !== this.peer;
      this.peer = m.from;
      if (!this.stream || this.offering) return;
      // Otras gafas, una conexión rota o nadie contestó: se vuelve a ofrecer.
      const broken = !this.pc || ['failed', 'closed', 'disconnected'].includes(this.pc.connectionState);
      if (other || broken || (!this.answered && performance.now() - this.sentAt > 4000)) this.offer(m.from);
    } else if (m.kind === 'answer' && m.to === ID && this.pc && !this.answered) {
      this.answered = true;
      this.pc.setRemoteDescription({ type: 'answer', sdp: m.sdp }).catch(console.error);
    }
  }
}

// Las gafas: pide el vídeo y lo deja en un elemento <video>.
export class Receptor {
  constructor(hub, onChange) {
    this.hub = hub;
    this.onChange = onChange;
    this.pc = null;
    this.video = document.createElement('video');
    this.video.muted = true;
    this.video.playsInline = true;
    this.video.autoplay = true;
    this.video.addEventListener('resize', () => onChange());
    this.timer = 0;
  }
  get state() {
    if (!this.timer) return 'off';
    return this.pc?.connectionState === 'connected' && this.video.srcObject ? 'connected' : this.pc ? 'connecting' : 'waiting';
  }
  start() {
    if (this.timer) return;
    this.timer = setInterval(() => this.hello(), 3000);
    this.hello();
    this.onChange();
  }
  stop() {
    clearInterval(this.timer);
    this.timer = 0;
    this.close();
    this.onChange();
  }
  close() {
    this.pc?.close();
    this.pc = null;
    this.video.srcObject = null;
  }
  hello() {
    if (this.pc?.connectionState !== 'connected') this.hub.send({ t: 'rtc', kind: 'hello', from: ID });
  }
  async signal(m) {
    if (!this.timer || (m.to && m.to !== ID)) return;
    if (m.kind === 'bye') {
      this.close();
      return this.onChange();
    }
    if (m.kind !== 'offer') return;
    this.close();
    const pc = (this.pc = new RTCPeerConnection({ iceServers: [] }));
    pc.addEventListener('connectionstatechange', () => {
      if (['failed', 'closed'].includes(pc.connectionState) && this.pc === pc) this.close();
      this.onChange();
    });
    pc.addEventListener('track', (e) => {
      this.video.srcObject = e.streams[0] || new MediaStream([e.track]);
      this.video.play().catch(() => {});
      this.onChange();
    });
    await pc.setRemoteDescription({ type: 'offer', sdp: m.sdp });
    await pc.setLocalDescription(await pc.createAnswer());
    await ready(pc);
    if (this.pc === pc) this.hub.send({ t: 'rtc', kind: 'answer', from: ID, to: m.from, sdp: pc.localDescription.sdp });
    this.onChange();
  }
}
