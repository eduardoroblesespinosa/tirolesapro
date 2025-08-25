import * as THREE from 'three';

document.addEventListener('DOMContentLoaded', () => {
    const canvas = document.getElementById('simulationCanvas');
    const simulationWrapper = document.getElementById('simulation-wrapper');
    const instructions = document.getElementById('instructions');
    const tensionSlider = document.getElementById('tension');
    const riderWeightSlider = document.getElementById('riderWeight');
    const riderWeightValue = document.getElementById('riderWeightValue');
    const simulateBtn = document.getElementById('simulateBtn');
    const resetBtn = document.getElementById('resetBtn');
    const environmentSelect = document.getElementById('environment');
    const dragCoefficientSlider = document.getElementById('dragCoefficient');
    const dragCoefficientValue = document.getElementById('dragCoefficientValue');
    const horizontalDistanceInput = document.getElementById('horizontalDistance');
    const verticalDropInput = document.getElementById('verticalDrop');

    // Data panel elements
    const statusEl = document.getElementById('status');
    const lengthEl = document.getElementById('length');
    const heightDiffEl = document.getElementById('height-diff');
    const slopeEl = document.getElementById('slope');
    const speedEl = document.getElementById('speed');

    const backgrounds = {
        none: 'none',
        bosque: 'url(bosque.png)',
        selva: 'url(selva.png)',
        desierto: 'url(desierto.png)',
        tundra: 'url(tundra.png)',
        montana: 'url(montana.png)',
        ciudad: 'url(ciudad.png)',
        caverna: 'url(caverna.png)',
        acuatico: 'url(acuatico.png)'
    };

    let renderer, scene, camera;
    let anchors = [];
    let state = 'PLACING_START'; // PLACING_START, PLACING_END, READY, SIMULATING, DRAGGING
    let rider, ziplineCurve, ziplineMesh;
    let startAnchorMesh, endAnchorMesh;
    let draggedAnchor = null;

    const PIXELS_PER_METER = 10;
    const GRAVITY = 9.81;

    // SCENE SETUP
    function initThree() {
        const width = canvas.clientWidth;
        const height = canvas.clientHeight;

        renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, alpha: true });
        renderer.setSize(width, height);
        renderer.setPixelRatio(window.devicePixelRatio);

        scene = new THREE.Scene();

        camera = new THREE.OrthographicCamera(0, width, height, 0, 1, 1000);
        camera.position.z = 10;

        // Add some lighting
        const ambientLight = new THREE.AmbientLight(0xffffff, 0.7);
        scene.add(ambientLight);
        const directionalLight = new THREE.DirectionalLight(0xffffff, 0.5);
        directionalLight.position.set(0, 1, 1);
        scene.add(directionalLight);
        
        // Create anchor visuals
        const anchorGeometry = new THREE.BoxGeometry(20, 20, 20);
        startAnchorMesh = new THREE.Mesh(anchorGeometry, new THREE.MeshStandardMaterial({color: 0x00ff00, roughness: 0.3}));
        endAnchorMesh = new THREE.Mesh(anchorGeometry, new THREE.MeshStandardMaterial({color: 0xff0000, roughness: 0.3}));
        startAnchorMesh.visible = false;
        endAnchorMesh.visible = false;
        scene.add(startAnchorMesh);
        scene.add(endAnchorMesh);

        resetSimulation();
    }

    function handleResize() {
        const width = canvas.clientWidth;
        const height = canvas.clientHeight;
        camera.right = width;
        camera.top = height;
        camera.updateProjectionMatrix();
        renderer.setSize(width, height);
    }
    
    window.addEventListener('resize', handleResize);

    const updateInstructions = (text) => {
        if (instructions.textContent === text) return;
        gsap.to(instructions, { opacity: 0, duration: 0.2, onComplete: () => {
            instructions.textContent = text;
            gsap.to(instructions, { opacity: 1, duration: 0.2 });
        }});
    };

    const updateState = (newState) => {
        state = newState;
        
        const isEditable = state === 'READY';
        horizontalDistanceInput.readOnly = !isEditable;
        verticalDropInput.readOnly = !isEditable;
        
        switch (state) {
            case 'PLACING_START':
                updateInstructions('Haz clic en el lienzo para establecer el punto de INICIO de la tirolesa.');
                simulateBtn.disabled = true;
                statusEl.textContent = 'Esperando diseño';
                canvas.style.cursor = 'crosshair';
                break;
            case 'PLACING_END':
                updateInstructions('Haz clic de nuevo para establecer el punto FINAL.');
                canvas.style.cursor = 'crosshair';
                break;
            case 'READY':
                updateInstructions('¡Diseño listo! Arrastra los puntos para ajustar o pulsa Simular.');
                simulateBtn.disabled = false;
                statusEl.textContent = 'Listo para simular';
                canvas.style.cursor = 'grab';
                updateInputsAndData();
                break;
            case 'SIMULATING':
                updateInstructions('¡Allá vamos!');
                simulateBtn.disabled = true;
                statusEl.textContent = 'En progreso...';
                canvas.style.cursor = 'default';
                break;
            case 'DRAGGING':
                updateInstructions('Soltar para fijar la nueva posición.');
                canvas.style.cursor = 'grabbing';
                break;
        }
    };

    const getMousePos = (event) => {
        const rect = canvas.getBoundingClientRect();
        return {
            x: event.clientX - rect.left,
            y: event.clientY - rect.top
        };
    };

    const handleMouseDown = (event) => {
        if (state === 'SIMULATING') return;
        const pos = getMousePos(event);

        if (state === 'PLACING_START') {
            anchors[0] = new THREE.Vector3(pos.x, pos.y, 0);
            startAnchorMesh.position.copy(anchors[0]);
            startAnchorMesh.visible = true;
            updateState('PLACING_END');
        } else if (state === 'PLACING_END') {
            anchors[1] = new THREE.Vector3(pos.x, pos.y, 0);
            endAnchorMesh.position.copy(anchors[1]);
            endAnchorMesh.visible = true;
            createZipline();
            updateState('READY');
        } else if (state === 'READY') {
            const checkDist = 15; // Click detection radius
            const mouseVec = new THREE.Vector3(pos.x, pos.y, 0);
            if (mouseVec.distanceTo(anchors[0]) < checkDist) {
                draggedAnchor = 0;
                updateState('DRAGGING');
            } else if (mouseVec.distanceTo(anchors[1]) < checkDist) {
                draggedAnchor = 1;
                updateState('DRAGGING');
            }
        }
    };

    const handleMouseMove = (event) => {
        if (state === 'SIMULATING') return;
        const pos = getMousePos(event);
        const mouseVec = new THREE.Vector3(pos.x, pos.y, 0);

        if (state === 'PLACING_END') {
            anchors[1] = mouseVec;
            endAnchorMesh.position.copy(mouseVec);
            endAnchorMesh.visible = true;
            createZipline();
        } else if (state === 'DRAGGING') {
            anchors[draggedAnchor].copy(mouseVec);
            const anchorMesh = (draggedAnchor === 0) ? startAnchorMesh : endAnchorMesh;
            anchorMesh.position.copy(mouseVec);
            createZipline();
            updateInputsAndData();
        } else if (state === 'READY') {
            const checkDist = 15;
            if (mouseVec.distanceTo(anchors[0]) < checkDist || mouseVec.distanceTo(anchors[1]) < checkDist) {
                canvas.style.cursor = 'grab';
            } else {
                canvas.style.cursor = 'default';
            }
        }
    };

    const handleMouseUp = () => {
        if (state === 'DRAGGING') {
            draggedAnchor = null;
            updateState('READY');
        }
    };

    const createZipline = () => {
        if (anchors.length < 2) return;
        if(ziplineMesh) scene.remove(ziplineMesh);

        const start = anchors[0];
        const end = anchors[1];
        
        const tension = parseFloat(tensionSlider.value);
        const midPoint = new THREE.Vector3().addVectors(start, end).multiplyScalar(0.5);
        const distance = start.distanceTo(end);
        midPoint.y += distance * tension; // Sag factor

        ziplineCurve = new THREE.QuadraticBezierCurve3(start, midPoint, end);
        
        const points = ziplineCurve.getPoints(50);
        const geometry = new THREE.BufferGeometry().setFromPoints(points);
        const material = new THREE.LineBasicMaterial({ color: 0xaaaaaa, linewidth: 2 });
        ziplineMesh = new THREE.Line(geometry, material);
        scene.add(ziplineMesh);
    }
    
    function createRider() {
        if (rider) scene.remove(rider);
        const geometry = new THREE.SphereGeometry(8, 16, 16);
        const material = new THREE.MeshStandardMaterial({ color: 0xe94560, metalness: 0.5, roughness: 0.2 });
        rider = new THREE.Mesh(geometry, material);
        rider.position.copy(anchors[0]);
        scene.add(rider);
    }

    const startSimulation = () => {
        if (state !== 'READY') return;
        
        createRider();
        updateState('SIMULATING');
        
        const curveLength = ziplineCurve.getLength();
        const vMax = calculateMaxSpeed(); // in m/s
        const duration = (curveLength / PIXELS_PER_METER) / (vMax * 0.7) ; // Approximate duration

        gsap.to({ t: 0 }, {
            t: 1,
            duration: Math.max(2, duration), // Minimum 2s duration
            ease: "power1.in",
            onUpdate: function() {
                const position = ziplineCurve.getPointAt(this.targets()[0].t);
                rider.position.copy(position);
            },
            onComplete: () => {
                updateState('READY');
            }
        });
    };
    
    const calculateMaxSpeed = () => {
        if (anchors.length < 2) return 0;
        
        const weight = parseFloat(riderWeightSlider.value);
        const drag = parseFloat(dragCoefficientSlider.value);

        const deltaY = (anchors[1].y - anchors[0].y) / PIXELS_PER_METER;
        const potentialEnergy = weight * GRAVITY * Math.abs(deltaY);
        
        // v = sqrt(2 * E_k / m). Simplified model, with drag factor.
        let maxSpeedMs = Math.sqrt(2 * potentialEnergy / weight);
        maxSpeedMs *= (1 - drag);
        return isNaN(maxSpeedMs) ? 0 : maxSpeedMs;
    };
    
    const updateInputsAndData = () => {
        if (anchors.length < 2) return;
        const start = anchors[0];
        const end = anchors[1];

        const horizontalDistMeters = (end.x - start.x) / PIXELS_PER_METER;
        const verticalDropMeters = (end.y - start.y) / PIXELS_PER_METER;

        horizontalDistanceInput.value = horizontalDistMeters.toFixed(1);
        verticalDropInput.value = verticalDropMeters.toFixed(1);
        
        updateDataPanel();
    }

    const updateDataPanel = () => {
        if (anchors.length < 2 || !ziplineCurve) return;

        const cableLengthMeters = ziplineCurve.getLength() / PIXELS_PER_METER;
        lengthEl.textContent = `${cableLengthMeters.toFixed(2)} m`;

        const heightDiffMeters = parseFloat(verticalDropInput.value);
        heightDiffEl.textContent = `${heightDiffMeters.toFixed(2)} m`;
        
        const horizontalDistMeters = parseFloat(horizontalDistanceInput.value);
        if (horizontalDistMeters !== 0) {
            const slopePercent = (Math.abs(heightDiffMeters) / Math.abs(horizontalDistMeters)) * 100;
            slopeEl.textContent = `${slopePercent.toFixed(1)} %`;
        } else {
             slopeEl.textContent = `Inf %`;
        }

        const maxSpeedMs = calculateMaxSpeed();
        const maxSpeedKmh = maxSpeedMs * 3.6;
        speedEl.textContent = `${maxSpeedKmh.toFixed(1)} km/h`;
    };
    
    const resetSimulation = () => {
        if (rider) {
            scene.remove(rider);
            rider = null;
        }
        if (ziplineMesh) {
            scene.remove(ziplineMesh);
            ziplineMesh = null;
        }

        anchors = [];
        ziplineCurve = null;
        startAnchorMesh.visible = false;
        endAnchorMesh.visible = false;
        
        updateState('PLACING_START');
        lengthEl.textContent = `0.00 m`;
        heightDiffEl.textContent = `0.00 m`;
        slopeEl.textContent = `0.0 %`;
        speedEl.textContent = `0.0 km/h`;
        horizontalDistanceInput.value = "0.0";
        verticalDropInput.value = "0.0";
    };
    
    function animate() {
        requestAnimationFrame(animate);
        renderer.render(scene, camera);
    }
    
    // Event Listeners
    canvas.addEventListener('mousedown', handleMouseDown);
    canvas.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    horizontalDistanceInput.addEventListener('change', (e) => {
        if (anchors.length < 2) return;
        const newHorizontalDistMeters = parseFloat(e.target.value);
        if (isNaN(newHorizontalDistMeters)) return;

        anchors[1].x = anchors[0].x + newHorizontalDistMeters * PIXELS_PER_METER;
        endAnchorMesh.position.copy(anchors[1]);
        
        createZipline();
        updateDataPanel();
    });

    verticalDropInput.addEventListener('change', (e) => {
        if (anchors.length < 2) return;
        const newVerticalDropMeters = parseFloat(e.target.value);
        if (isNaN(newVerticalDropMeters)) return;

        anchors[1].y = anchors[0].y + newVerticalDropMeters * PIXELS_PER_METER;
        endAnchorMesh.position.copy(anchors[1]);

        createZipline();
        updateDataPanel();
    });

    resetBtn.addEventListener('click', () => {
        gsap.killTweensOf({t:0}); // Stop any running simulation
        resetSimulation();
    });
    simulateBtn.addEventListener('click', startSimulation);

    tensionSlider.addEventListener('input', () => {
        if (anchors.length === 2) {
            createZipline();
            updateDataPanel();
        }
    });

    riderWeightSlider.addEventListener('input', (e) => {
        const weight = e.target.value;
        riderWeightValue.textContent = `${weight} kg`;
        if (anchors.length === 2) {
             updateDataPanel();
        }
    });

    dragCoefficientSlider.addEventListener('input', (e) => {
        const drag = e.target.value;
        dragCoefficientValue.textContent = parseFloat(drag).toFixed(2);
        if (anchors.length === 2) {
             updateDataPanel();
        }
    });

    environmentSelect.addEventListener('change', (e) => {
        const selectedEnv = e.target.value;
        if (selectedEnv === 'none') {
            simulationWrapper.style.backgroundImage = '';
            canvas.style.backgroundColor = ''; // Revert to CSS default, which has a color
        } else {
            simulationWrapper.style.backgroundImage = backgrounds[selectedEnv];
            canvas.style.backgroundColor = 'transparent'; // Make canvas transparent to show wrapper's bg
        }
    });

    initThree();
    animate();
});