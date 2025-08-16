// script.js
// MVP: detecta automaticamente o cartão quadrado 10x10 no cliente com OpenCV.js
// e permite marcar manualmente os centros das pupilas com UX melhorada (desfazer, arrastar).
// Observação: OpenCV.js carrega de forma assíncrona — aguardamos 'cv' ficar pronto.

let canvas = document.getElementById('imageCanvas');
let ctx = canvas.getContext('2d');
let img = new Image();
let originalImageData = null;

let points = []; // guardará {x, y} em coordenadas do canvas (pixels)
let scale_mm_per_pixel = null; // mm por pixel
const CARD_MM = 100; // cartão HPR é 10x10 cm => 100 mm

const overlayHint = document.getElementById('overlayHint');
const instructionsEl = document.getElementById('instructions');
const resultEl = document.getElementById('result');

const imageLoader = document.getElementById('imageLoader');
const autoDetectBtn = document.getElementById('autoDetectCard');
const autoDetectPupilsBtn = document.getElementById('autoDetectPupils');
const undoBtn = document.getElementById('undoPoint');
const clearBtn = document.getElementById('clearPoints');
const exportBtn = document.getElementById('exportResults');

let isDraggingPoint = false;
let dragIndex = -1;
let devicePixelRatioBackup = window.devicePixelRatio || 1;

imageLoader.addEventListener('change', handleImage, false);
canvas.addEventListener('click', canvasClick, false);
canvas.addEventListener('mousedown', startDragPoint, false);
canvas.addEventListener('mousemove', moveDragPoint, false);
canvas.addEventListener('mouseup', endDragPoint, false);
canvas.addEventListener('mouseleave', endDragPoint, false);

autoDetectBtn.addEventListener('click', () => {
    if (!img.src) return alert('Carregue uma imagem primeiro.');
    if (typeof cv === 'undefined') return alert('OpenCV.js ainda não carregado. Aguarde alguns segundos e tente novamente.');
    detectCardAndCalcScale();
});

undoBtn.addEventListener('click', () => {
    points.pop();
    drawCanvas();
    updateResult();
});
clearBtn.addEventListener('click', () => {
    points = [];
    scale_mm_per_pixel = null;
    drawCanvas();
    updateResult();
    instructionsEl.innerText = 'Limpo. Carregue imagem e detecte o cartão (ou marque manualmente).';
});
exportBtn.addEventListener('click', exportResults);

// Bind para auto detectar pupilas (integração com loader sob-demanda no HTML)
if (autoDetectPupilsBtn) {
    autoDetectPupilsBtn.addEventListener('click', autoDetectPupilsHandler);
}

function handleImage(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function(event) {
        img.onload = function() {
            // ajusta canvas para visualização (manter ratio)
            const maxW = 900;
            const maxH = 700;
            let w = img.width;
            let h = img.height;
            const ratio = Math.min(maxW / w, maxH / h, 1);
            canvas.width = Math.round(w * ratio);
            canvas.height = Math.round(h * ratio);

            // guardamos dimensão de desenho e dimensão real da imagem para conversões
            canvas.dataset.ratio = ratio; // usado para converter clicks
            drawCanvas();
            instructionsEl.innerText = 'Imagem carregada. Clique em "Auto detectar cartão" ou marque manualmente os pontos.';
        }
        img.src = event.target.result;
    }
    reader.readAsDataURL(file);
}

// Convert click position in client coords to image coords (canvas pixel coords)
function clientToCanvasCoord(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    const x = (clientX - rect.left) * (canvas.width / rect.width);
    const y = (clientY - rect.top) * (canvas.height / rect.height);
    return { x, y };
}

// Click: marca ponto (centro da pupila)
function canvasClick(evt) {
    // se clicou em ponto existente para arrastar, handled by mousedown
    if (isDraggingPoint) return;
    const { x, y } = clientToCanvasCoord(evt.clientX, evt.clientY);
    points.push({ x, y });
    drawCanvas();
    if (points.length === 1 && !scale_mm_per_pixel) {
        instructionsEl.innerText = '1º ponto marcado. Se preferir, use Auto-detectar para calibrar o cartão automático.';
    } else if (points.length === 2 && !scale_mm_per_pixel) {
        instructionsEl.innerText = 'Marque os 2 centros das pupilas (ou detecte o cartão primeiro para escala automática).';
    } else {
        instructionsEl.innerText = `Pontos: ${points.length}. Você pode arrastar um ponto para ajustar.`;
    }
    updateResult();
}

// Drag support: se o clique estiver dentro de uma bolinha de ponto, inicia arraste
function startDragPoint(evt) {
    const pos = clientToCanvasCoord(evt.clientX, evt.clientY);
    for (let i = 0; i < points.length; i++) {
        const p = points[i];
        const dx = pos.x - p.x;
        const dy = pos.y - p.y;
        const dist = Math.sqrt(dx*dx + dy*dy);
        if (dist < 12) { // sensibilidade em pixels de canvas
            isDraggingPoint = true;
            dragIndex = i;
            return;
        }
    }
}

function moveDragPoint(evt) {
    if (!isDraggingPoint || dragIndex < 0) return;
    const pos = clientToCanvasCoord(evt.clientX, evt.clientY);
    points[dragIndex].x = pos.x;
    points[dragIndex].y = pos.y;
    drawCanvas();
    updateResult();
}

function endDragPoint(evt) {
    if (!isDraggingPoint) return;
    isDraggingPoint = false;
    dragIndex = -1;
}

// Desenha imagem + pontos + sobreposições
function drawCanvas() {
    // espera OpenCV? não necessário para desenho
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    // desenha imagem ajustada ao canvas (resized)
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

    // overlay do cartão detectado (se existir em dataset)
    if (canvas.dataset.cardCorners) {
        try {
            const corners = JSON.parse(canvas.dataset.cardCorners);
            ctx.save();
            ctx.strokeStyle = 'lime';
            ctx.lineWidth = 2;
            ctx.beginPath();
            corners.forEach((pt, idx) => {
                const px = pt.x * (canvas.width / img.width);
                const py = pt.y * (canvas.height / img.height);
                if (idx === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
            });
            ctx.closePath();
            ctx.stroke();
            ctx.restore();
        } catch (e) {
            // ignore
        }
    }

    // desenha pontos
    ctx.save();
    ctx.fillStyle = 'rgba(220,50,50,0.95)';
    ctx.strokeStyle = 'white';
    ctx.lineWidth = 2;
    points.forEach((p, idx) => {
        ctx.beginPath();
        ctx.arc(p.x, p.y, 8, 0, Math.PI*2);
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = '#fff';
        ctx.font = '12px sans-serif';
        ctx.fillText((idx+1).toString(), p.x+10, p.y-10);
        ctx.fillStyle = 'rgba(220,50,50,0.95)';
    });
    ctx.restore();

    // se temos escala, mostrar texto
    if (scale_mm_per_pixel) {
        ctx.save();
        ctx.fillStyle = 'rgba(0,0,0,0.6)';
        ctx.font = '14px sans-serif';
        ctx.fillText(`Escala: ${ (scale_mm_per_pixel*1000).toFixed(3) } mm/px`, 10, 20);
        ctx.restore();
    }

    // atualizar hint visibility
    overlayHint.style.display = img.src ? 'none' : 'block';
}

// ********************
// Auto-detect card (OpenCV.js)
// ********************
function detectCardAndCalcScale() {
    instructionsEl.innerText = 'Detectando cartão — aguarde...';
    resultEl.innerText = '';
    // cria mat do tamanho real da imagem (não o canvas reduzido) para melhor detecção
    // vamos desenhar a imagem em um canvas temporário para pegar dados na resolução original
    const tmp = document.createElement('canvas');
    tmp.width = img.width;
    tmp.height = img.height;
    const tctx = tmp.getContext('2d');
    tctx.drawImage(img, 0, 0);

    // pega imageData e cria Mat
    const imgData = tctx.getImageData(0, 0, tmp.width, tmp.height);
    let src = cv.matFromImageData(imgData);

    // processar: gray -> blur -> canny -> findContours
    let gray = new cv.Mat();
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY, 0);
    let ksize = new cv.Size(5,5);
    cv.GaussianBlur(gray, gray, ksize, 0, 0, cv.BORDER_DEFAULT);
    let edges = new cv.Mat();
    cv.Canny(gray, edges, 50, 150);

    // dilate to close gaps
    let M = cv.Mat.ones(3,3, cv.CV_8U);
    cv.dilate(edges, edges, M);

    let contours = new cv.MatVector();
    let hierarchy = new cv.Mat();
    cv.findContours(edges, contours, hierarchy, cv.RETR_LIST, cv.CHAIN_APPROX_SIMPLE);

    let bestQuad = null;
    let bestArea = 0;

    for (let i = 0; i < contours.size(); i++) {
        let cnt = contours.get(i);
        let peri = cv.arcLength(cnt, true);
        let approx = new cv.Mat();
        cv.approxPolyDP(cnt, approx, 0.02 * peri, true);
        // buscar polígonos com 4 vértices (quadriláteros), área razoável e convexos
        if (approx.rows === 4 && cv.isContourConvex(approx)) {
            let area = cv.contourArea(approx);
            if (area > bestArea) {
                // verificar razão aspecto ~1 (porque nosso cartão é quadrado)
                // calcular bounding rect
                let rect = cv.minAreaRect(approx);
                let size = rect.size;
                let w = size.width, h = size.height;
                let aspect = w > h ? w/h : h/w;
                // aceitável até 1.6 (para fotos levemente inclinadas/pequena perspectiva)
                if (aspect < 1.6) {
                    bestArea = area;
                    bestQuad = approx.clone();
                }
            }
        }
        approx.delete();
        cnt.delete();
    }

    if (!bestQuad) {
        cleanup();
        alert('Cartão não detectado automaticamente. Tente melhorar iluminação, contraste ou marque manualmente dois pontos nas bordas do cartão.');
        instructionsEl.innerText = 'Cartão não detectado. Tente novamente ou marque manualmente.';
        return;
    }

    // extrair os 4 pontos do bestQuad (em ordem)
    let corners = [];
    for (let i = 0; i < 4; i++) {
        corners.push({ x: bestQuad.data32S[i*2], y: bestQuad.data32S[i*2+1] });
    }

    // ordenar os cantos (TL, TR, BR, BL) para consistência — usando soma/diferença
    corners.sort((a,b) => (a.x + a.y) - (b.x + b.y)); // simples, cuidado com casos extremos
    // para segurança, vamos usar minX/minY etc para aproximar
    corners = sortQuadCorners(corners);

    // calcula pixel width como a média das distâncias entre cantos adjacentes superiores e inferiores
    const topWidth = distance(corners[0], corners[1]);
    const bottomWidth = distance(corners[3], corners[2]);
    const cardPixelWidth = (topWidth + bottomWidth) / 2.0;

    // escala mm por pixel
    scale_mm_per_pixel = CARD_MM / cardPixelWidth; // mm per pixel in original image coords

    // guardamos cantos no dataset (em coords da imagem original) para desenhar no canvas reduzido
    canvas.dataset.cardCorners = JSON.stringify(corners);

    // convert scale to canvas pixel units (our points are in canvas coords)
    // but scale_mm_per_pixel is per original-image pixel. When user marks points on canvas,
    // we convert canvas coords to original image coords multiplying by (img.width / canvas.width)
    instructionsEl.innerText = `Cartão detectado. Escala definida: ${scale_mm_per_pixel.toFixed(6)} mm/px (imagem original). Agora marque centros das pupilas.`;
    drawCanvas();
    updateResult();

    // cleanup
    cleanup();

    function cleanup() {
        src.delete(); gray.delete(); edges.delete(); contours.delete(); hierarchy.delete(); M.delete();
        if (bestQuad) bestQuad.delete();
    }
}

// helper para ordenar cantos do quadrado de forma consistente [TL, TR, BR, BL]
function sortQuadCorners(pts) {
    // pts: array de 4 {x,y} (não necessariamente em ordem)
    // vamos encontrar TL (min x+y), BR (max x+y), TR (min x - y), BL (max x - y) - heurística robusta
    let sums = pts.map(p => p.x + p.y);
    let diffs = pts.map(p => p.x - p.y);
    let tl = pts[sums.indexOf(Math.min(...sums))];
    let br = pts[sums.indexOf(Math.max(...sums))];
    let tr = pts[diffs.indexOf(Math.min(...diffs))];
    let bl = pts[diffs.indexOf(Math.max(...diffs))];
    return [tl, tr, br, bl];
}

function distance(a,b) {
    return Math.hypot(a.x - b.x, a.y - b.y);
}

// atualiza resultado exibido (DPN/DP) se possível
function updateResult() {
    resultEl.innerText = '';
    if (!scale_mm_per_pixel) {
        resultEl.innerText = 'Escala não definida. Detecte o cartão ou importe imagem calibrada.';
    }
    if (points.length >= 2) {
        // tomamos os 2 primeiros pontos como pupilas esquerda/direita (ordem do clique)
        // Convert canvas coords -> original image pixel coords
        const ratio = canvas.dataset.ratio ? parseFloat(canvas.dataset.ratio) : (canvas.width / img.width);
        // relação canvas->orig: origX = canvasX / ratio
        const p1 = { x: points[0].x / ratio, y: points[0].y / ratio };
        const p2 = { x: points[1].x / ratio, y: points[1].y / ratio };
        const pixDist = Math.hypot(p1.x - p2.x, p1.y - p2.y);
        if (scale_mm_per_pixel) {
            const dp_mm = pixDist * scale_mm_per_pixel;
            resultEl.innerText = `DP (interpupilar): ${dp_mm.toFixed(2)} mm`;
        } else {
            resultEl.innerText = `Distância em pixels: ${pixDist.toFixed(2)} px (detecte cartão para converter em mm)`;
        }
    }
}

// Exportar resultados (txt)
function exportResults() {
    if (points.length < 2) {
        alert('Marque ao menos 2 pontos (centros das pupilas) para exportar.');
        return;
    }
    const ratio = canvas.dataset.ratio ? parseFloat(canvas.dataset.ratio) : (canvas.width / img.width);
    const p1 = { x: points[0].x / ratio, y: points[0].y / ratio };
    const p2 = { x: points[1].x / ratio, y: points[1].y / ratio };
    const pixDist = Math.hypot(p1.x - p2.x, p1.y - p2.y);
    let text = 'Pupilometro - Resultados\n';
    if (scale_mm_per_pixel) {
        text += `Escala (mm/pi  xel): ${scale_mm_per_pixel.toFixed(6)}\n`;
        text += `DP (mm): ${(pixDist * scale_mm_per_pixel).toFixed(2)}\n`;
    } else {
        text += `DP (px): ${pixDist.toFixed(2)}\n`;
        text += 'Escala não definida.\n';
    }
    points.forEach((p, i) => {
        text += `Ponto ${i+1} (canvas px): (${p.x.toFixed(2)}, ${p.y.toFixed(2)})\n`;
    });

    const blob = new Blob([text], { type: 'text/plain' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'pupilometro_resultados.txt';
    link.click();
}

drawCanvas();


// ---------------------------
// Adição pupilas com fallback WebGL CPU e image downscale  provavelmente vai precisar de refatoração caso pc muito fraco
// ---------------------------
async function autoDetectPupilsHandler() {
    // validações iniciais, garantir, (isso realmente funciona?)
    if (!img || !img.src) {
        return alert('Carregue uma imagem primeiro.');
    }
    instructionsEl.innerText = 'Detectando pupilas...';

    // tenta obter detector via função global criada no HTML (loader sob-demanda)
    let detector = null;
    if (typeof loadFaceModelIfNeeded === 'function') {
        detector = await loadFaceModelIfNeeded();
    }

    if (!detector) {
        instructionsEl.innerText = 'Modelo de detecção indisponível. Tente novamente.';
        return;
    }

    try {
        // --- 1) cria temp canvas reduzido para economizar memória GPU ---
        const MAX_SIDE = 640; // ajuste se quiser: 480, 800, etc.
        let scaleForModel = Math.min(MAX_SIDE / img.width, MAX_SIDE / img.height, 1);
        const tmp = document.createElement('canvas');
        tmp.width = Math.round(img.width * scaleForModel);
        tmp.height = Math.round(img.height * scaleForModel);
        const tctx = tmp.getContext('2d');
        tctx.drawImage(img, 0, 0, tmp.width, tmp.height);

        // função interna para tentar detectar usando um detector específico
        async function tryDetect(detectorToUse) {
            if (!detectorToUse) return null;
            // usar predictIrises quando possível
            if (typeof detectorToUse.estimateFaces === 'function') {
                try {
                    return await detectorToUse.estimateFaces({ input: tmp, predictIrises: true });
                } catch (e) {
                    // fallback sem options
                    return await detectorToUse.estimateFaces(tmp);
                }
            } else if (typeof detectorToUse.detect === 'function') {
                return await detectorToUse.detect(tmp);
            } else return null;
        }

        // --- 2 tentativa 1: usar o detector atual (provavelmente webgl) com a imagem reduzida ---
        let faces = await tryDetect(detector);

        // --- 3 se falhar por motivos WebGL (ou faces vazio), tentar fallback CPU ---
        if (!faces || faces.length === 0) {
            // tenta trocar backend para cpu e recriar detector
            if (typeof tf !== 'undefined' && typeof faceLandmarksDetection !== 'undefined') {
                try {
                    // dispose do detector atual se suportado
                    if (detector && typeof detector.dispose === 'function') {
                        try { detector.dispose(); } catch(e){ /* ignore */ }
                    }
                    await tf.setBackend('cpu');
                    await tf.ready();
                    // recria detector em CPU
                    detector = await faceLandmarksDetection.createDetector(
                        faceLandmarksDetection.SupportedModels.MediaPipeFaceMesh,
                        { runtime: 'tfjs', refineLandmarks: true }
                    );
                    // tenta detectar novamente (com o mesmo temp canvas)
                    faces = await tryDetect(detector);
                } catch (cpuErr) {
                    console.warn('Tentativa CPU também falhou:', cpuErr);
                }
            }
        }

        // --- 4 se ainda não houver faces, abortar com mensagem ---
        if (!faces || faces.length === 0) {
            instructionsEl.innerText = 'Nenhuma face detectada (ou modelo falhou). Ajuste a foto ou tente reduzir a resolução.';
            return;
        }

        // --- 5 escolher face principal (mesma lógica sua) ---
        let chosen = faces[0];
        if (faces.length > 1) {
            let bestIdx = 0; let bestArea = 0;
            for (let i = 0; i < faces.length; i++) {
                const f = faces[i];
                const bb = f.boundingBox || f.box || null;
                if (bb) {
                    const w = bb.width || Math.abs((bb.bottomRight && bb.topLeft) ? bb.bottomRight[0] - bb.topLeft[0] : 0);
                    const h = bb.height || Math.abs((bb.bottomRight && bb.topLeft) ? bb.bottomRight[1] - bb.topLeft[1] : 0);
                    const area = w*h;
                    if (area > bestArea) { bestArea = area; bestIdx = i; }
                }
            }
            chosen = faces[bestIdx];
        }

        // --- 6 extrair íris (annotations, scaledMesh ou keypoints) ---
        const ann = chosen.annotations || {};
        let leftIrisPts = ann.leftEyeIris || ann.leftIris || null;
        let rightIrisPts = ann.rightEyeIris || ann.rightIris || null;

        // scaledMesh fallback (padrão em algumas versões)
        if ((!leftIrisPts || !rightIrisPts) && Array.isArray(chosen.scaledMesh)) {
            const mesh = chosen.scaledMesh;
            leftIrisPts = mesh.slice(468, 473);
            rightIrisPts = mesh.slice(473, 478);
            console.log('Usando scaledMesh para íris (fallback).');
        }

        // KEYPOINTS fallback (caso retornem keypoints: Array(478))
        if ((!leftIrisPts || !rightIrisPts) && Array.isArray(chosen.keypoints)) {
            // keypoints podem ser [{x,y,...}, ...] ou [x,y,z] arrays dependendo da build
            const kp = chosen.keypoints;
            // defensivo: verificar tipo do primeiro ponto
            const sample = kp[0];
            if (sample && typeof sample === 'object' && !Array.isArray(sample) && 'x' in sample && 'y' in sample) {
                // formato {x,y}
                leftIrisPts = kp.slice(468, 473).map(p => ({ x: p.x, y: p.y }));
                rightIrisPts = kp.slice(473, 478).map(p => ({ x: p.x, y: p.y }));
            } else if (Array.isArray(sample)) {
                // formato [x,y,z]
                leftIrisPts = kp.slice(468, 473).map(p => [p[0], p[1]]);
                rightIrisPts = kp.slice(473, 478).map(p => [p[0], p[1]]);
            } else {
                // pontos numéricos simples? tentar extrair x/y de propriedades conhecidas
                leftIrisPts = kp.slice(468, 473);
                rightIrisPts = kp.slice(473, 478);
            }
            console.log('Usando keypoints para íris (fallback).');
        }

        if (!leftIrisPts || !rightIrisPts) {
            console.warn('Não foi possível localizar pontos das íris automaticamente. Veja objeto da face no console:', chosen);
            console.log(chosen);
            instructionsEl.innerText = 'Não foi possível extrair íris automaticamente. Ajuste manualmente.';
            return;
        }

        // centroid simples
        function centroid(pointsArr) {
            let sx = 0, sy = 0, n = 0;
            for (const p of pointsArr) {
                if (Array.isArray(p)) { sx += p[0]; sy += p[1]; }
                else if ('x' in p && 'y' in p) { sx += p.x; sy += p.y; }
                else if (typeof p === 'number') { /* ignore */ }
                n++;
            }
            return { x: sx / n, y: sy / n };
        }

        const leftCentTemp = centroid(leftIrisPts);   // coordenadas em pixels do temp canvas
        const rightCentTemp = centroid(rightIrisPts);

        // fator para converter do temp canvas -> canvas exibido:
        const canvasFactor = (canvas.width / img.width) / scaleForModel;

        const leftCanvas = { x: leftCentTemp.x * canvasFactor, y: leftCentTemp.y * canvasFactor };
        const rightCanvas = { x: rightCentTemp.x * canvasFactor, y: rightCentTemp.y * canvasFactor };

        points[0] = leftCanvas;
        points[1] = rightCanvas;

        drawCanvas();
        updateResult();
        instructionsEl.innerText = 'Pupilas detectadas (ajuste manual se necessário).';

    } catch (err) {
       console.error('Erro durante auto-detect pupilas:', err);
        // mensagem amigável
        instructionsEl.innerText = 'Erro na detecção automática (problema WebGL/ memória). Tente reduzir a resolução da imagem ou usar outra máquina.';
    }
}
