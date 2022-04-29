// file imports directly from CDN
import {
  WebGLRenderer,
  ACESFilmicToneMapping,
  sRGBEncoding,
  Color,
  Clock,
  CylinderGeometry,
  CircleGeometry,
  PlaneGeometry,
  RepeatWrapping,
  DoubleSide,
  BoxGeometry,
  Mesh,
  PointLight,
  MeshPhysicalMaterial,
  PerspectiveCamera,
  Scene,
  PMREMGenerator,
  PCFSoftShadowMap,
  Vector2,
  Vector3,
  TextureLoader,
  SphereGeometry,
  MeshStandardMaterial,
  MeshBasicMaterial,
  FloatType,
  ConeGeometry,
  AmbientLight
} from 'three';

import { OrbitControls } from 'OrbitControls';
import { FBXLoader } from 'FBXLoader';
import { RGBELoader } from 'RGBELoader';
import { mergeBufferGeometries } from 'BufferGeometryUtils';
import { Water } from 'Water';

import SimplexNoise from 'https://cdn.skypack.dev/simplex-noise';

// Instantiate Relevant Items
let scene, camera, controls, renderer, clock, water;
let envmap, pmrem;
let light, ambientLight;

// Define World Settings
// we can control max height to make things more flat or not.
const MAX_HEIGHT = 8;

// map dimensions
const LENGTH = 40;
const MAX_DISTANCE_THRESHOLD = Math.floor(0.8 * LENGTH);
const BABYRABBITS_NUM = Math.floor(LENGTH / 10);
const FOXES_NUM = Math.floor(LENGTH / 15);
const BEARS_NUM = Math.floor(LENGTH / 45);
const WATER_HEIGHT = 0.15;

function initScene() {
  // Initialize Camera
  camera = new PerspectiveCamera(75, innerWidth / innerHeight, 0.1, 1000);
  camera.position.set(-17, 35, 31);

  // Initialize Scene
  scene = new Scene();
  scene.background = new Color("#FFEECC");

  //Initialize Clock
  clock = new Clock();

  // Initialize Renderer
  renderer = new WebGLRenderer({
    antialias: true
  });
  renderer.setSize(innerWidth, innerHeight);
  renderer.setPixelRatio( window.devicePixelRatio );

  // ACES Filmic Tone Mapping maps high dynamic range (HDR) lighting conditions
  // to low dynamic range (LDR) digital screen representations.
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.outputEncoding = sRGBEncoding;
  renderer.physicallyCorrectLights = true;
  renderer.shadowMap.enabled = true;

  // we have several options for shadow mapping, but after testing, this does
  // seem to be the best we have. Although we could try VSMShadowMap or
  // PCFShadowMap for performance reasons.
  renderer.shadowMap.type = PCFSoftShadowMap;
  document.body.appendChild(renderer.domElement);

  // Set up Camera Manipulation
  controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 0, 0);
  controls.dampingFactor = 0.05;
  controls.enableDamping = true;
  controls.enableZoom = true;
  controls.enablePan = true;
}

function initLights() {
  // set up lights, color should be mostly white. Even a small bit other imbalance
  // is shown pretty obviously.
  light = new PointLight(new Color("#fee2d2").convertSRGBToLinear().convertSRGBToLinear(), 60, 200);
  light.position.set(10, 20, 10);

  light.castShadow = true;
  light.shadow.mapSize.width = 512;
  light.shadow.mapSize.height = 512;
  light.shadow.camera.near = 0.5;
  light.shadow.camera.far = 500;
  scene.add(light);

  // add ambient lighting to soften things out
  ambientLight = new AmbientLight(new Color("#fee2d2").convertSRGBToLinear().convertSRGBToLinear(), 0.5);
  ambientLight.position.set(-5, 10, -15);
  scene.add(ambientLight);
}

initScene();
initLights();
buildScene();
animateScene();

// dictionary that maps the tilePosition to the hex
let positionToHexDict = new Map();
// map storing impassible terrain
let hardTerrain = new Map();
// keyState of up down left or right
let keyState;
let globalRabbit;

// dictionary that maps xy 1D coordinate to tilePosition
let bears = [];
let foxes = [];

// dictionary that maps xy 1D coordinate to tilePosition
let XYtoPositionDict = new Map();
let babyRabbits = [];
let isBabyRabbitUnited = [];
let lives = 10;
let totalScore = 3*3600;
let bearTraps = [];

// current Time 
let start = Date.now(); // remember start time
let timeScore = 0;
  


// general FBX loader
function loadAsset(path) {
  return new Promise((resolve, reject) => {
    const fbxLoader = new FBXLoader();
    fbxLoader.load(path, (asset) => resolve(asset));
  })
}

// this entire function is asynchronous, meaning that it is not concerned with
// the order in which things are declared/instantiated as long as dependencies
// are declared/instantiated at some point within this file. Note that this function
// only runs once. The animation loop is built into the WebGL renderer, which
// functions slightly differently from the one given in our starter code.

// also note that, within the async function, order still matters when it comes
// to instantiating/declaring things in the right order.
async function buildScene() {
  // environment map set up. await in this case means that the command here will
  // wait for RGBE Loader to finish processing the HDR file before continuing.
  let pmrem = new PMREMGenerator(renderer);
  pmrem.compileEquirectangularShader();

  let envmapTexture = await new RGBELoader().loadAsync("assets/envmap.hdr");
  let rt = pmrem.fromEquirectangular(envmapTexture);
  envmap = rt.texture;

  // load in textures for different hex types. Using minecraft texture packs
  // is actually a very good idea for skinning the tiles.
  let textures = {
    dirt: await new TextureLoader().loadAsync("assets/dirt.png"),
    dirt2: await new TextureLoader().loadAsync("assets/dirt2.png"),
    grass: await new TextureLoader().loadAsync("assets/grass.png"),
    sand: await new TextureLoader().loadAsync("assets/sand.png"),
    water: await new TextureLoader().loadAsync("assets/water.jpg"),
    stone: await new TextureLoader().loadAsync("assets/stone.png"),
  };

  // noise for generating different heights. we could use a different noise
  // engine if we wanted actually, depending on what we want.
  const simplex = new SimplexNoise();

  // create 40x40 hex map, varying height using simplex noise. This will be
  // larger for our purposes, but I haven't tested quite yet.
  for (let i = -LENGTH; i <= LENGTH; i++) {
    for (let j = -LENGTH; j <= LENGTH; j++) {
      // calculate position for current tile
      let position = tileToPosition(i, j);

      // if position is within desired radius, add a hex
      if (position.length() < MAX_DISTANCE_THRESHOLD) {
        let noise = (simplex.noise2D(i * 0.1, j * 0.1) + 1) * 0.5;
        noise = Math.pow(noise, 1.5);

        XYtoPositionDict.set(XYto1D(i, j), position);
        if (noise <= WATER_HEIGHT) {
          hardTerrain.set(position, 1);
        } else {
          hardTerrain.set(position, 0);
        }

        hex(noise * MAX_HEIGHT, position, envmap);
      }
    }
  }

  // adds the aggregate geometries of each terrain type and textures them
  let stoneMesh = hexMesh(stoneGeo, textures.stone);
  let grassMesh = hexMesh(grassGeo, textures.grass);
  let dirt2Mesh = hexMesh(dirt2Geo, textures.dirt2);
  let dirtMesh = hexMesh(dirtGeo, textures.dirt);
  let sandMesh = hexMesh(sandGeo, textures.sand);
  scene.add(stoneMesh, dirtMesh, dirt2Mesh, sandMesh, grassMesh);

  // adds the water texture
  let seaTexture = textures.water;
  seaTexture.repeat = new Vector2(1, 1);
  seaTexture.wrapS = RepeatWrapping;
  seaTexture.wrapT = RepeatWrapping;

  // water.js water
  const textureLoader = new TextureLoader();
  const waterGeometry = new CircleGeometry( 0.85 * LENGTH, 64 );
	water = new Water( waterGeometry, {
		color: new Color("#ffffff"),
		scale: 1,
		flowDirection: new Vector2( 0.1 , 0.05 ),
		textureWidth: 1024,
		textureHeight: 1024,
    normalMap0: textureLoader.load( 'assets/Water_1_M_Normal.jpg' ),
    normalMap1: textureLoader.load( 'assets/Water_2_M_Normal.jpg' ),
	} );

	water.position.set(0, MAX_HEIGHT * WATER_HEIGHT, 0);
	water.rotation.x = Math.PI * - 0.5;
	scene.add( water );

  // defines and adds the map floor
  let mapFloor = new Mesh(
    new CylinderGeometry(0.9 * LENGTH, 0.9 * LENGTH, MAX_HEIGHT * 0.1, 50),
    new MeshPhysicalMaterial({
      envMap: envmap,
      map: textures.dirt2,
      envMapIntensity: 0.1,
      side: DoubleSide,
    })
  );
  mapFloor.receiveShadow = true;
  mapFloor.position.set(0, -MAX_HEIGHT * 0.05, 0);
  scene.add(mapFloor);

  // load in rabbit asset and set global rabbit variable
  loadAsset('assets/rabbit.fbx').then((rabbit) => {
    rabbit.scale.multiplyScalar(0.05);

    let tilePosition = XYtoPositionDict.get(XYto1D(0, 0));
    let translationVec = positionToHexDict.get(tilePosition)[1];

    rabbit.translateX(translationVec.x);
    rabbit.translateY(translationVec.y);
    rabbit.translateZ(translationVec.z);
    rabbit.tileX = 0;
    rabbit.tileY = 0;

    scene.add(rabbit);

    globalRabbit = rabbit;
    globalRabbit.angleMetric = 60;
    globalRabbit.rotateY(Math.PI / 6);
    globalRabbit.rotateY(2 * Math.PI / 3);
  })

  // add event listener for rabbit
  document.addEventListener("keydown", function(event) {
    keyState = event.key;
    moveRabbitUponSpacebar();
    updateRabbitPerspective();
  });

  // add baby rabbits (for now, spheres with smaller radii)
  generateBabyRabbits();
  // add bears to the scene
  generateBears();
  // add bear traps to the scene
  // generateBearTraps();
  generateFoxes();

  // move wolves every second
  window.setInterval(updateFoxes, 1000);
  
  renderer.setAnimationLoop(() => {
    //controls.update();
    //renderer.render(scene, camera);
    //updateWolves();
    //updateSphere(sphere);
    updateScore();
  });

  // move wolves every second
  // window.setInterval(updateWolves, 1000);
  /*
  
  renderer.setAnimationLoop(() => {
    //controls.update();
    renderer.render(scene, camera);
    //updateWolves();
  }); */
}

// animation
function animateScene() {
  requestAnimationFrame( animateScene );
  controls.update();
	render();
}

function render() {
  const delta = clock.getDelta();
  renderer.render(scene, camera);
}

// creates baby rabbits in the form of white spheres of half the radius, and adds them to the scene
function generateBabyRabbits() {
  for (let i = 0; i < BABYRABBITS_NUM; i++) {
    // get a random valid tile
    let tile = getRandomValidTile();
    // load in rabbit asset and set global rabbit variable
    loadAsset('assets/rabbit.fbx').then((rabbit) => {
      rabbit.scale.multiplyScalar(0.03);

      let translationVec = positionToHexDict.get(tile[0])[1];

      rabbit.translateX(translationVec.x);
      rabbit.translateY(translationVec.y);
      rabbit.translateZ(translationVec.z);
      rabbit.tileX = tile[1];
      rabbit.tileY = tile[2];

      isBabyRabbitUnited.push(false);
      babyRabbits.push(rabbit);

      scene.add(rabbit);
    })
  }
}

// creates bears and adds them to the scene
function generateBears() {
  for (let i = 0; i < BEARS_NUM; i++) {
    // get a random valid tile
    let tile = getRandomValidTile();
    // load in bear asset and set global bear variable
    loadAsset('assets/08bearFinal.fbx').then((bear) => {
      bear.scale.multiplyScalar(0.015);

      let translationVec = positionToHexDict.get(tile[0])[1];

      bear.translateX(translationVec.x);
      bear.translateY(translationVec.y);
      bear.translateZ(translationVec.z);
      bear.tileX = tile[1];
      bear.tileY = tile[2];

      bears.push(bear);
      scene.add(bear);
    })
  }
}

// creates bear traps in the form of yellow cones, and adds them to the scene
/*
function generateBearTraps() {
  for (let i = 0; i < BEARTRAPS_NUM; i++) {
    let geometry = new ConeGeometry( 1, 5, 32 );
    let material = new MeshBasicMaterial( {color: 0x808080} );
    let bearTrap = new Mesh( geometry, material );

    bearTraps.push(bearTrap);
    scene.add(bearTrap);
    // randomly put bear traps on the scene
    while (true) {
      let i = Math.floor(MAX_DISTANCE_THRESHOLD* Math.random() - MAX_DISTANCE_THRESHOLD/2);
      let j = Math.floor(MAX_DISTANCE_THRESHOLD * Math.random() - MAX_DISTANCE_THRESHOLD/2);
      let tilePosition = XYtoPositionDict.get(XYto1D(i, j));
      // keep looking for tiles until you have one that is actually on the terrain
      if (tilePosition == undefined) continue;
      let translationVec = positionToHexDict.get(tilePosition)[1];
      bearTrap.translateX(translationVec.x);
      bearTrap.translateY(translationVec.y);
      bearTrap.translateZ(translationVec.z);
      bearTrap.tileX = i;
      bearTrap.tileY = j;
      break;
    }
  }
}
*/

// creates wolves in the form of yellow black spheres, and adds them to the scene
function generateFoxes() {
  for (let i = 0; i < FOXES_NUM; i++) {
    // get a random valid tile
    let tile = getRandomValidTile();
    // load in fox asset
    loadAsset('assets/01foxFinal.fbx').then((fox) => {
      fox.scale.multiplyScalar(0.017);

      let translationVec = positionToHexDict.get(tile[0])[1];

      fox.translateX(translationVec.x);
      fox.translateY(translationVec.y);
      fox.translateZ(translationVec.z);
      fox.tileX = tile[1];
      fox.tileY = tile[2];

      foxes.push(fox);
      scene.add(fox);
    })

  }
}

// returns all accessible adjacent tiles
function getAllAdjacentTiles(tileX, tileY) {
  let possibleTiles = [];
  let tilePosition;

  tilePosition = XYtoPositionDict.get(XYto1D(tileX + 1, tileY));
  if (checkValidTile(tilePosition)) {
    possibleTiles.push(XYto1D(tileX + 1, tileY));
  }

  tilePosition = XYtoPositionDict.get(XYto1D(tileX - 1, tileY));
  if (checkValidTile(tilePosition)) {
    possibleTiles.push(XYto1D(tileX - 1, tileY));
  }

  // if y tile is even
  if (mod(tileY, 2) == 1) {
    tilePosition = XYtoPositionDict.get(XYto1D(tileX + 1, tileY + 1));
    if (checkValidTile(tilePosition)) {
      possibleTiles.push(XYto1D(tileX + 1, tileY + 1));
    }

    tilePosition = XYtoPositionDict.get(XYto1D(tileX, tileY + 1));
    if (checkValidTile(tilePosition)) {
      possibleTiles.push(XYto1D(tileX, tileY + 1));
    }

    tilePosition = XYtoPositionDict.get(XYto1D(tileX, tileY - 1));
    if (checkValidTile(tilePosition)) {
      possibleTiles.push(XYto1D(tileX, tileY - 1));
    }

    tilePosition = XYtoPositionDict.get(XYto1D(tileX + 1, tileY - 1));
    if (checkValidTile(tilePosition)) {
      possibleTiles.push(XYto1D(tileX + 1, tileY - 1));
    }
  } else if (mod(tileY, 2) == 0) {
    tilePosition = XYtoPositionDict.get(XYto1D(tileX, tileY + 1));
    if (checkValidTile(tilePosition)) {
      possibleTiles.push(XYto1D(tileX, tileY + 1));
    }

    tilePosition = XYtoPositionDict.get(XYto1D(tileX - 1, tileY + 1));
    if (checkValidTile(tilePosition)) {
      possibleTiles.push(XYto1D(tileX - 1, tileY + 1));
    }

    tilePosition = XYtoPositionDict.get(XYto1D(tileX - 1, tileY - 1));
    if (checkValidTile(tilePosition)) {
      possibleTiles.push(XYto1D(tileX - 1, tileY - 1));
    }

    tilePosition = XYtoPositionDict.get(XYto1D(tileX, tileY - 1));
    if (checkValidTile(tilePosition)) {
      possibleTiles.push(XYto1D(tileX, tileY - 1));
    }
  }
  return possibleTiles;
}

// helper function for getting adjacent tiles
function checkValidTile(tilePosition) {
  return getByValue(XYtoPositionDict, tilePosition) != undefined && hardTerrain.get(tilePosition) != 1;
}

// helper function for getting a valid random tile
function getRandomValidTile() {
  while (true) {
    let i = Math.floor(MAX_DISTANCE_THRESHOLD * Math.random() - MAX_DISTANCE_THRESHOLD / 2);
    let j = Math.floor(MAX_DISTANCE_THRESHOLD * Math.random() - MAX_DISTANCE_THRESHOLD / 2);

    let tilePosition = XYtoPositionDict.get(XYto1D(i, j));
    // keep looking for tiles until you have one that is actually on the terrain
    if (tilePosition == undefined) continue;
    if (!checkValidTile(tilePosition)) continue;

    // set this tile position to be occupied
    hardTerrain.set(tilePosition, 1);

    return [tilePosition, i, j];
  }
}

// finds the tile closes in straight line distance to the rabbit
function getClosestAdjacentTileToRabbit(allAdjacent, excluding) {
  let minDistance = Infinity;
  let closestTile;

  
  for (let tile1D of allAdjacent) {
    if (excluding != null) {
      let skipTile = false;
      for (let otherWolf of excluding) {
        if (otherWolf == tile1D) {
          skipTile = true;
          break;
        }
      }
      if (skipTile) continue;
    }
    let tile = XYtoPositionDict.get(tile1D);
    let rabbitPosition = XYtoPositionDict.get(XYto1D(globalRabbit.tileX, globalRabbit.tileY));
    if (tile.distanceTo(rabbitPosition) < minDistance) {
      closestTile = tile1D;
      minDistance = tile.distanceTo(rabbitPosition);
    }
  }
  return closestTile;
}


  // wolves move randomly to a neighboring tile
  function updateFoxes() {
    //delta = clock.getDelta();
    for (let fox of foxes) {
      let allAdjacent = getAllAdjacentTiles(fox.tileX, fox.tileY);
      
      let excluding = [];
      for (let otherFox of foxes) {
        excluding.push(XYto1D(otherFox.tileX, otherFox.tileY));
      }
      let closestAdjacentTile = getClosestAdjacentTileToRabbit(allAdjacent, excluding);
      
      if (XYtoPositionDict.get(closestAdjacentTile) == undefined) continue;
      
      let translationVec = positionToHexDict.get(XYtoPositionDict.get(closestAdjacentTile))[1];
      
      /*
      console.log("rabbit's position");
      console.log(globalRabbit.tileX, globalRabbit.tileY);
  
      console.log("FOX's old position");
      console.log(fox.tileX, fox.tileY); */
  
      fox.position.x = translationVec.x;
      fox.position.y = translationVec.y; //+ radius/2;
      fox.position.z = translationVec.z;
  
      let arr = oneDtoXY(closestAdjacentTile);
      fox.tileX = arr[0];
      fox.tileY = arr[1];
  
      /*
      console.log("Fox's new position");
      console.log(fox.tileX, fox.tileY); */
  
      if ((globalRabbit.position.x == fox.position.x) && (globalRabbit.position.z == fox.position.z)) {
        lives--;
        totalScore = Math.round(totalScore*0.93);
      }
      // check if contact with any of the babyRabbits
      for (let babyRabbit of babyRabbits) {
        if ((babyRabbit.position.x == fox.position.x) && (globalRabbit.position.z == fox.position.z)) {
          console.log("BABY RABBIT REMOVED");
          scene.remove(babyRabbit);
          totalScore = Math.round(totalScore * 0.85);
          //numOfBabiesSaved -= 1;
        }
      }
  
    }
  }
  

/*
// wolves move randomly to a neighboring tile
function updateFoxes() {
  //delta = clock.getDelta();
  for (let fox of foxes) {
    let allAdjacent = getAllAdjacentTiles(fox.tileX, fox.tileY);
    let closestAdjacentTile = getClosestAdjacentTileToRabbit(allAdjacent, fox.tileX, fox.tileY);

    if (XYtoPositionDict.get(oneDtoXY(closestAdjacentTile)) == undefined) continue;

    let translationVec = positionToHexDict.get(XYtoPositionDict.get(oneDtoXY(closestAdjacentTile)))[1];

    fox.position.x = translationVec.x;
    fox.position.y = translationVec.y + radius / 2;
    fox.position.z = translationVec.z;

    fox.tileX, fox.tileY = oneDtoXY(closestAdjacentTile);

    if ((globalRabbit.position.x == fox.position.x) && (globalRabbit.position.z == fox.position.z)) {
      updateLives();
    }
  }
}
*/
function updateRabbitPerspective() {
  let prevX = globalRabbit.tileX;
  let prevY = globalRabbit.tileY;
  if (keyState == "ArrowLeft") {
    //camera.rotateY(1.047);
    globalRabbit.rotateY(Math.PI / 3);
    globalRabbit.angleMetric = mod(globalRabbit.angleMetric + 60, 360);
  }
  if (keyState == "ArrowRight") {
    //camera.rotateY(-1.047);
    globalRabbit.rotateY(-Math.PI / 3);
    globalRabbit.angleMetric = mod(globalRabbit.angleMetric - 60, 360);
  }
}

function mod(n, m) {
  return ((n % m) + m) % m;
}

function moveRabbitUponSpacebar() {
  let prevX = globalRabbit.tileX;
  let prevY = globalRabbit.tileY;

  if (keyState != " ") return;

  if (mod(globalRabbit.angleMetric, 360) == 0) {
    globalRabbit.tileX += 1;
  } else if (mod(globalRabbit.angleMetric + 180, 360) == 0) {
    globalRabbit.tileX -= 1;
  }
  // if y tile is even
  else if (mod(prevY, 2) == 1) {
    if (mod(globalRabbit.angleMetric + 60, 360) == 0) {
      globalRabbit.tileX += 1;
      globalRabbit.tileY += 1;
    }
    if (mod(globalRabbit.angleMetric + 120, 360) == 0) {
      globalRabbit.tileY += 1;
    }
    if (mod(globalRabbit.angleMetric + 240, 360) == 0) {
      globalRabbit.tileY -= 1;
    }
    if (mod(globalRabbit.angleMetric + 300, 360) == 0) {
      globalRabbit.tileX += 1;
      globalRabbit.tileY -= 1;
    }
  } else if (mod(prevY, 2) == 0) {
    if (mod(globalRabbit.angleMetric + 60, 360) == 0) {
      globalRabbit.tileX += 0;
      globalRabbit.tileY += 1;
    }
    if (mod(globalRabbit.angleMetric + 120, 360) == 0) {
      globalRabbit.tileX += -1;
      globalRabbit.tileY += 1;
    }
    if (mod(globalRabbit.angleMetric + 240, 360) == 0) {
      globalRabbit.tileX += -1;
      globalRabbit.tileY += -1;
    }
    if (mod(globalRabbit.angleMetric + 300, 360) == 0) {
      globalRabbit.tileX += 0;
      globalRabbit.tileY += -1;
    }
  }  
  //   check of the one that you want to go to is a valid tile

  let tilePosition = XYtoPositionDict.get(XYto1D(globalRabbit.tileX, globalRabbit.tileY));

  if ((tilePosition == undefined)) {
    globalRabbit.tileX = prevX;
    globalRabbit.tileY = prevY;
    return;
  }

  let translationVec = positionToHexDict.get(tilePosition)[1];

  globalRabbit.position.x = translationVec.x;
  globalRabbit.position.y = translationVec.y; // + radisu;
  globalRabbit.position.z = translationVec.z;

  updateBabyRabbits();
  updateBearTraps();
}

// rabbit moves to next tile upon click
function updateRabbit() {
  let prevX = globalRabbit.tileX;
  let prevY = globalRabbit.tileY;

  if (keyState == "ArrowLeft") globalRabbit.tileX += 1;
  if (keyState == "ArrowRight") globalRabbit.tileX += -1;
  if (keyState == "ArrowUp") globalRabbit.tileY += 1;
  if (keyState == "ArrowDown") globalRabbit.tileY += -1;
  let tilePosition = XYtoPositionDict.get(XYto1D(globalRabbit.tileX, globalRabbit.tileY));

  if (tilePosition == undefined) {
    globalRabbit.tileX = prevX;
    globalRabbit.tileY = prevY;
    return;
  }

  let translationVec = positionToHexDict.get(tilePosition)[1];
  let currPosition = globalRabbit.position;
  //animateSphereMovement(rabbit, currPosition, translationVec);

  globalRabbit.position.x = translationVec.x;
  globalRabbit.position.y = translationVec.y; // + radisu;
  globalRabbit.position.z = translationVec.z;

  updateBabyRabbits();
  //updateHunterZones();
  updateBearTraps();

}

// Baby rabbits disappear upon contact with rabbit
function updateBabyRabbits() {
  let allAdjacent = getAllAdjacentTiles(globalRabbit.tileX, globalRabbit.tileY);

  for (let i = 0; i < babyRabbits.length; i++) {
    let babyRabbit = babyRabbits[i];
    // if babyRabbit is on same position as rabbit, update babyRabbitUnited array
    if ((babyRabbit.tileX == globalRabbit.tileX) && (babyRabbit.tileY == globalRabbit.tileY)) {
      //numOfBabiesSaved++;
      isBabyRabbitUnited[i] = true;
    }
    // if the baby rabbit isn't even united, don't worry
    if (!isBabyRabbitUnited[i]) {
      continue;
    }
    let tilePositionOfGlobalRabbit = XYtoPositionDict.get(XYto1D(globalRabbit.tileX, globalRabbit.tileY));
    if (allAdjacent == null) break;
    if (i >= allAdjacent.length) continue;

    // if you are on water tile and baby is not adjacent to you, baby should remain where it is
    //if (!checkValidTile(tilePositionOfGlobalRabbit)) continue;
    /*
    console.log(allAdjacent);
    console.log(i);
    console.log(allAdjacent[i]);
    console.log(XYtoPositionDict.get(allAdjacent[i]));
    console.log(positionToHexDict.get(XYtoPositionDict.get(allAdjacent[i]))); */
    let translationVec = positionToHexDict.get(XYtoPositionDict.get(allAdjacent[i]))[1]
    babyRabbit.position.x = translationVec.x;
    babyRabbit.position.y = translationVec.y;// + radius/2;
    babyRabbit.position.z = translationVec.z;

    let arr = oneDtoXY(allAdjacent[i]);
    babyRabbit.tileX, babyRabbit.tileY = arr[0], arr[1];
  }
}
  
function updateScore() {
  let timePassed = Math.round((Date.now() - start)/1000);
  totalScore = totalScore + timeScore - timePassed;
  timeScore = timePassed;

  let heartString = "";
  for (let i = 0; i < lives; i++) heartString += "❤️";
  
  document.getElementById('totalScore').innerHTML = "Total Score: " + totalScore.toString();
  document.getElementById('hitpoints').innerHTML = "Lives Remaining: " + heartString;
  requestAnimationFrame(updateScore);
}

// bear traps spin up out of the ground upon contact with rabbit
function updateBearTraps() {
  for (let bearTrap of bearTraps) {
    if ((bearTrap.tileX == globalRabbit.tileX) && (bearTrap.tileY == globalRabbit.tileY)) {
      bearTrap.translateY(10);
    }
  }
}

// converts x,y coordinate to 1D (dumb implementation)
function XYto1D(x, y) {
  return 10000 * x + y;
}

// converts 1D coordinate to tileX, tileY (dumb implementation)
function oneDtoXY(key) {
  return [Math.floor(key / 10000), Math.round(mod(key, 10000))];
}

// converts index numbers for X and Y into proper coordinates for hexagons
// actually adds the hexagons edge to edge, meaning the hexagons wiggle around
// a little bit when being added.
function tileToPosition(tileX, tileY) {
  return new Vector2((tileX + (tileY % 2) * 0.5) * 1.77, tileY * 1.535);
}

// creates a single hexagonal prism object at the given height and position
// this is a helper function to the hex function below. It creates the actual
// object but hex calls it and then skins the object appropriately.
function hexGeometry(height, position) {
  let geo = new CylinderGeometry(1, 1, height, 6, 1, false);
  geo.translate(position.x, height * 0.5, position.y);

  return geo;
}

// sets thresholds for texturing hexes according to height
const STONE_HEIGHT = MAX_HEIGHT * 0.8;
const DIRT_HEIGHT = MAX_HEIGHT * 0.65;
const GRASS_HEIGHT = MAX_HEIGHT * 0.35;
const SAND_HEIGHT = MAX_HEIGHT * WATER_HEIGHT + 0.01;
const DIRT2_HEIGHT = MAX_HEIGHT * 0;

// instantiates geometries storing aggregate hex groupings for each terrain
let stoneGeo = new BoxGeometry(0, 0, 0);
let dirtGeo = new BoxGeometry(0, 0, 0);
let dirt2Geo = new BoxGeometry(0, 0, 0);
let sandGeo = new BoxGeometry(0, 0, 0);
let grassGeo = new BoxGeometry(0, 0, 0);

// creates a hex at a given height and position and adds them to the proper
// aggregate geometry that is defined above. Uses aforementioned thresholds.
function hex(height, tilePosition) {
  let geo = hexGeometry(height, tilePosition);
  positionToHexDict.set(tilePosition, [geo, new Vector3(tilePosition.x, height, tilePosition.y)]);
  if (height > STONE_HEIGHT) {
    stoneGeo = mergeBufferGeometries([geo, stoneGeo]);

    // if tile is valid and not on rabbit spawn point load in a terrain asset
    if (checkValidTile(tilePosition) && (tilePosition.x != 0 && tilePosition.y != 0)) {
      let randomValue = Math.random();
      if (randomValue > 0.80) {
        loadAsset('assets/PP_Rock_Moss_Grown_09.fbx').then((rock) => {
          rock.scale.multiplyScalar(0.004);

          let translationVec = positionToHexDict.get(tilePosition)[1];
          rock.translateX(translationVec.x);
          rock.translateY(translationVec.y);
          rock.translateZ(translationVec.z);

          hardTerrain.set(tilePosition, 1);

          scene.add(rock);
        })
      }
    }

  } else if (height > DIRT_HEIGHT) {
    dirtGeo = mergeBufferGeometries([geo, dirtGeo]);

    // if tile is valid and not on rabbit spawn point load in a terrain asset
    if (checkValidTile(tilePosition) && (tilePosition.x != 0 && tilePosition.y != 0)) {
      let randomValue = Math.random();
      if (randomValue > 0.90) {
        loadAsset('assets/PP_Mushroom_Fantasy_Purple_08.fbx').then((shroom) => {
          shroom.scale.multiplyScalar(0.08);

          let translationVec = positionToHexDict.get(tilePosition)[1];
          shroom.translateX(translationVec.x);
          shroom.translateY(translationVec.y);
          shroom.translateZ(translationVec.z);

          scene.add(shroom);
        })
      } else if (randomValue > 0.80) {
        loadAsset('assets/PP_Mushroom_Fantasy_Orange_09.fbx').then((shroom) => {
          shroom.scale.multiplyScalar(0.04);

          let translationVec = positionToHexDict.get(tilePosition)[1];
          shroom.translateX(translationVec.x);
          shroom.translateY(translationVec.y);
          shroom.translateZ(translationVec.z);

          scene.add(shroom);
        })
      }
    }

  } else if (height > GRASS_HEIGHT) {
    grassGeo = mergeBufferGeometries([geo, grassGeo]);

    // if tile is valid and not on rabbit spawn point load in a terrain asset
    if (checkValidTile(tilePosition) && (tilePosition.x != 0 && tilePosition.y != 0)) {
      let randomValue = Math.random();
      if (randomValue > 0.97) {
        loadAsset('assets/PP_Birch_Tree_05.fbx').then((tree) => {
          tree.scale.multiplyScalar(0.015);

          let translationVec = positionToHexDict.get(tilePosition)[1];
          tree.translateX(translationVec.x);
          tree.translateY(translationVec.y);
          tree.translateZ(translationVec.z);

          hardTerrain.set(tilePosition, 1);

          scene.add(tree);
        })
      } else if (randomValue > 0.94) {
        loadAsset('assets/PP_Tree_02.fbx').then((tree) => {
          tree.scale.multiplyScalar(0.015);

          let translationVec = positionToHexDict.get(tilePosition)[1];
          tree.translateX(translationVec.x);
          tree.translateY(translationVec.y);
          tree.translateZ(translationVec.z);

          hardTerrain.set(tilePosition, 1);

          scene.add(tree);
        })
      } else if (randomValue > 0.92) {
        loadAsset('assets/PP_Hyacinth_04.fbx').then((flower) => {
          flower.scale.multiplyScalar(0.05);

          let translationVec = positionToHexDict.get(tilePosition)[1];
          flower.translateX(translationVec.x);
          flower.translateY(translationVec.y);
          flower.translateZ(translationVec.z);

          scene.add(flower);
        })
      } else if (randomValue > 0.82) {
        loadAsset('assets/PP_Grass_11.fbx').then((grass) => {
          grass.scale.multiplyScalar(0.05);

          let translationVec = positionToHexDict.get(tilePosition)[1];
          grass.translateX(translationVec.x);
          grass.translateY(translationVec.y);
          grass.translateZ(translationVec.z);

          scene.add(grass);
        })
      } else if (randomValue > 0.81) {
        loadAsset('assets/PP_Rock_Pile_Forest_Moss_05.fbx').then((rock) => {
          rock.scale.multiplyScalar(0.004);

          let translationVec = positionToHexDict.get(tilePosition)[1];
          rock.translateX(translationVec.x);
          rock.translateY(translationVec.y);
          rock.translateZ(translationVec.z);

          hardTerrain.set(tilePosition, 1);

          scene.add(rock);
        })
      } else if (randomValue > 0.71) {
        loadAsset('assets/PP_Grass_15.fbx').then((grass) => {
          grass.scale.multiplyScalar(0.05);

          let translationVec = positionToHexDict.get(tilePosition)[1];
          grass.translateX(translationVec.x);
          grass.translateY(translationVec.y);
          grass.translateZ(translationVec.z);

          scene.add(grass);
        })
      }
    }

  } else if (height > SAND_HEIGHT) {
    sandGeo = mergeBufferGeometries([geo, sandGeo]);

    // if tile is valid and not on rabbit spawn point load in a terrain asset
    if (checkValidTile(tilePosition) && (tilePosition.x != 0 && tilePosition.y != 0)) {
      let randomValue = Math.random();
      if (randomValue > 0.90) {
        loadAsset('assets/PP_Rock_Moss_Grown_11.fbx').then((rock) => {
          rock.scale.multiplyScalar(0.004);

          let translationVec = positionToHexDict.get(tilePosition)[1];
          rock.translateX(translationVec.x);
          rock.translateY(translationVec.y);
          rock.translateZ(translationVec.z);

          hardTerrain.set(tilePosition, 1);

          scene.add(rock);
        })
      }
    }

  } else if (height > DIRT2_HEIGHT) {
    dirt2Geo = mergeBufferGeometries([geo, dirt2Geo]);
  }
}

// helper function for traversing Map by value
function getByValue(map, searchValue) {
  for (let [key, value] of map.entries()) {
    if (value === searchValue)
      return key;
  }
  return undefined;
}

// used to return the total aggregate geometry that is rendered by the renderer.
// this is done so that the GPU only has one mesh to constantly update.
function hexMesh(geo, map) {
  let mat = new MeshPhysicalMaterial({
    envMap: envmap,
    envMapIntensity: 0.135,
    flatShading: true,
    map
  });

  let mesh = new Mesh(geo, mat);
  mesh.castShadow = true; //default is false
  mesh.receiveShadow = true; //default

  return mesh;
}
