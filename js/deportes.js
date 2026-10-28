// Deportes que se eligen al crear un equipo o una cuenta personal.
// Cada uno dice qué le exige al cuerpo, para que el plan automático sepa qué priorizar:
//   exige:    fuerza | potencia | resistencia | agilidad | contacto | movilidad | agarre | equilibrio
//   zonas:    grupos que más trabaja o hay que proteger (para elegir rutinas)
//   met:      intensidad típica por hora de práctica (calorías)
//   liviano:  ¿el gym de ese día debería ser liviano? (deportes muy exigentes)

export const GRUPOS = [
  { clave: 'fuerza', nombre: 'Fuerza y gimnasio' },
  { clave: 'contacto', nombre: 'Equipo con contacto' },
  { clave: 'equipo', nombre: 'Equipo' },
  { clave: 'combate', nombre: 'Combate' },
  { clave: 'resistencia', nombre: 'Resistencia' },
  { clave: 'raqueta', nombre: 'Raqueta' },
  { clave: 'aventura', nombre: 'Montaña, agua y ruedas' },
  { clave: 'cuerpo', nombre: 'Cuerpo y mente' },
];

const d = (clave, nombre, grupo, exige, zonas, met, liviano = false) => ({ clave, nombre, grupo, exige, zonas, met, liviano });

export const LISTA = [
  // Fuerza y gimnasio
  d('gym', 'Gym / musculación', 'fuerza', ['fuerza'], [], 5),
  d('powerlifting', 'Powerlifting', 'fuerza', ['fuerza'], ['piernas', 'espalda', 'pecho'], 6),
  d('halterofilia', 'Halterofilia', 'fuerza', ['potencia', 'movilidad'], ['piernas', 'hombros', 'core'], 6),
  d('crossfit', 'CrossFit / funcional', 'fuerza', ['fuerza', 'resistencia', 'potencia'], ['core', 'hombros'], 8, true),
  d('calistenia', 'Calistenia', 'fuerza', ['fuerza', 'agarre', 'movilidad'], ['espalda', 'hombros', 'core'], 6),
  d('strongman', 'Strongman', 'fuerza', ['fuerza', 'agarre'], ['espalda', 'piernas', 'antebrazos'], 7, true),
  d('hyrox', 'Hyrox', 'fuerza', ['resistencia', 'fuerza'], ['piernas', 'core'], 9, true),

  // Equipo con contacto
  d('roller_derby', 'Roller derby', 'contacto', ['contacto', 'agilidad', 'resistencia', 'potencia'], ['piernas', 'gluteos', 'core', 'trapecios'], 6.5, true),
  d('rugby', 'Rugby', 'contacto', ['contacto', 'potencia', 'resistencia'], ['cuello', 'trapecios', 'piernas', 'core'], 8, true),
  d('futbol_americano', 'Fútbol americano', 'contacto', ['contacto', 'potencia'], ['cuello', 'trapecios', 'piernas'], 8, true),
  d('hockey', 'Hockey (hielo o patines)', 'contacto', ['contacto', 'agilidad', 'potencia'], ['piernas', 'gluteos', 'core'], 8, true),
  d('waterpolo', 'Waterpolo', 'contacto', ['contacto', 'resistencia'], ['hombros', 'espalda', 'piernas'], 10, true),
  d('lacrosse', 'Lacrosse', 'contacto', ['contacto', 'agilidad'], ['hombros', 'core', 'piernas'], 8, true),

  // Equipo
  d('futbol', 'Fútbol', 'equipo', ['resistencia', 'agilidad'], ['piernas', 'isquios', 'core'], 7, true),
  d('futsal', 'Futsal / indor', 'equipo', ['agilidad', 'resistencia'], ['piernas', 'core'], 8, true),
  d('basquet', 'Básquet', 'equipo', ['potencia', 'agilidad'], ['piernas', 'pantorrillas', 'core'], 6.5, true),
  d('voley', 'Vóley', 'equipo', ['potencia', 'agilidad'], ['hombros', 'piernas', 'pantorrillas'], 4),
  d('ecuavoley', 'Ecuavóley', 'equipo', ['agilidad'], ['hombros', 'piernas'], 4),
  d('handball', 'Handball', 'equipo', ['potencia', 'agilidad', 'contacto'], ['hombros', 'piernas'], 8, true),
  d('beisbol', 'Béisbol / softbol', 'equipo', ['potencia'], ['hombros', 'core', 'antebrazos'], 5),
  d('ultimate', 'Ultimate frisbee', 'equipo', ['agilidad', 'resistencia'], ['piernas', 'core'], 8, true),

  // Combate
  d('boxeo', 'Boxeo', 'combate', ['potencia', 'resistencia'], ['hombros', 'core', 'piernas'], 9, true),
  d('muay_thai', 'Muay thai / kickboxing', 'combate', ['potencia', 'resistencia', 'contacto'], ['core', 'piernas', 'hombros'], 10, true),
  d('mma', 'MMA', 'combate', ['contacto', 'fuerza', 'resistencia'], ['cuello', 'core', 'agarre'], 10, true),
  d('jiu_jitsu', 'Jiu-jitsu / grappling', 'combate', ['agarre', 'fuerza', 'movilidad'], ['cuello', 'espalda', 'antebrazos', 'core'], 8, true),
  d('judo', 'Judo', 'combate', ['agarre', 'potencia'], ['espalda', 'antebrazos', 'piernas'], 9, true),
  d('lucha', 'Lucha', 'combate', ['fuerza', 'contacto', 'agarre'], ['cuello', 'espalda', 'piernas'], 9, true),
  d('karate', 'Karate', 'combate', ['potencia', 'movilidad'], ['piernas', 'core'], 7),
  d('taekwondo', 'Taekwondo', 'combate', ['potencia', 'movilidad'], ['piernas', 'gluteos', 'core'], 8),
  d('esgrima', 'Esgrima', 'combate', ['agilidad'], ['piernas', 'hombros'], 6),

  // Resistencia
  d('running', 'Running', 'resistencia', ['resistencia'], ['piernas', 'pantorrillas', 'gluteos', 'core'], 9.5),
  d('trail', 'Trail running', 'resistencia', ['resistencia', 'equilibrio'], ['piernas', 'tobillos', 'core'], 10, true),
  d('ciclismo', 'Ciclismo de ruta', 'resistencia', ['resistencia'], ['piernas', 'gluteos', 'core', 'espalda'], 8),
  d('mtb', 'Ciclismo de montaña', 'resistencia', ['resistencia', 'potencia'], ['piernas', 'core', 'antebrazos'], 9),
  d('natacion', 'Natación', 'resistencia', ['resistencia'], ['espalda', 'hombros', 'core'], 8),
  d('triatlon', 'Triatlón', 'resistencia', ['resistencia'], ['piernas', 'espalda', 'hombros'], 10, true),
  d('remo', 'Remo', 'resistencia', ['resistencia', 'fuerza'], ['espalda', 'piernas', 'core'], 8),
  d('senderismo', 'Senderismo / caminata', 'resistencia', ['resistencia'], ['piernas', 'gluteos'], 5),

  // Raqueta
  d('tenis', 'Tenis', 'raqueta', ['agilidad', 'potencia'], ['hombros', 'antebrazos', 'core', 'piernas'], 7),
  d('padel', 'Pádel', 'raqueta', ['agilidad'], ['hombros', 'antebrazos', 'piernas'], 6),
  d('squash', 'Squash', 'raqueta', ['agilidad', 'resistencia'], ['piernas', 'antebrazos'], 9, true),
  d('badminton', 'Bádminton', 'raqueta', ['agilidad'], ['hombros', 'piernas'], 5.5),
  d('tenis_mesa', 'Tenis de mesa', 'raqueta', ['agilidad'], ['antebrazos', 'piernas'], 4),

  // Montaña, agua y ruedas
  d('escalada', 'Escalada / boulder', 'aventura', ['agarre', 'fuerza', 'movilidad'], ['espalda', 'antebrazos', 'core', 'hombros'], 7),
  d('andinismo', 'Andinismo / montañismo', 'aventura', ['resistencia', 'fuerza'], ['piernas', 'core', 'espalda'], 7, true),
  d('surf', 'Surf', 'aventura', ['equilibrio', 'resistencia'], ['hombros', 'espalda', 'core'], 5),
  d('skate', 'Skate', 'aventura', ['equilibrio', 'potencia'], ['piernas', 'tobillos', 'core'], 5),
  d('patinaje', 'Patinaje', 'aventura', ['equilibrio', 'resistencia'], ['piernas', 'gluteos', 'core'], 7),
  d('esqui', 'Esquí / snowboard', 'aventura', ['equilibrio', 'fuerza'], ['piernas', 'core'], 6),
  d('kayak', 'Kayak / canotaje', 'aventura', ['resistencia'], ['espalda', 'hombros', 'core'], 5),

  // Cuerpo y mente
  d('yoga', 'Yoga', 'cuerpo', ['movilidad', 'equilibrio'], ['core'], 3),
  d('pilates', 'Pilates', 'cuerpo', ['movilidad', 'fuerza'], ['core', 'gluteos'], 3.5),
  d('danza', 'Danza / baile', 'cuerpo', ['resistencia', 'movilidad'], ['piernas', 'core'], 5.5),
  d('gimnasia', 'Gimnasia', 'cuerpo', ['fuerza', 'movilidad', 'potencia'], ['hombros', 'core', 'espalda'], 6),
  d('aereos', 'Pole / telas / aéreos', 'cuerpo', ['fuerza', 'agarre', 'movilidad'], ['espalda', 'hombros', 'antebrazos', 'core'], 6),

  d('otro', 'Otro', 'cuerpo', [], [], 5),
];

export const DEPORTES = Object.fromEntries(LISTA.map((x) => [x.clave, x]));
export const deporte = (clave) => DEPORTES[clave] ?? DEPORTES.otro;
export const nombreDeporte = (clave) => deporte(clave).nombre;
