# Night Ride Throught Budapest

Looper + caja de ritmos para hacer música **minimal / rominian / Budapest night techno**, pensado para trabajar de noche, en privado y sin tocar parámetros: grabas, el ambiente se genera solo y tú te dedicas a componer.

Es una página web que funciona **sin instalar nada** y **sin conexión**. Nada sale de tu equipo.

## Cómo abrirla

- **Doble clic en `INICIAR.bat`** (recomendado): abre un servidor local en `http://localhost:5173` y el navegador. Ahí el navegador recuerda el permiso del micrófono.
- O abre `index.html` directamente (funciona, pero Chrome volverá a pedir el micrófono cada vez).

Usa **Chrome o Edge** y, si puedes, **auriculares**: el micrófono nunca suena por los altavoces, pero si los altavoces suenan cerca el micro los recogerá en las grabaciones.

## Qué hay en pantalla (de arriba abajo)

| Zona | Qué hace |
|---|---|
| Cabecera | Play/stop (`Espacio`), BPM, compás y pulso, **KEY** (tonalidad), **LOOP** (duración fija de las grabaciones o AUTO), entrada de **MIC** con su medidor. |
| KICK · CLAP · SNARE · HAT · OPEN HAT | Secuenciador de pasos estilo 909. Clic activa/desactiva, arrastrar pinta, **clic derecho** = acento → normal → fantasma. Clic en el nombre = escucharlo. |
| `≈` de cada pista | **Swing**, **Humanize** y **Groove** (plantillas de micro-tiempo y dinámica) individuales. En la batería, además, la duración del patrón (1, 2 o 4 compases). |
| BASS | Vista compacta de las notas; **PIANO ROLL** abre el editor: cuantización 1/4 · 1/8 · 1/16 · 1/32 · tresillos o **LIBRE**, longitud 1/2/4 compases. |
| REC 1–4 | Cuatro pistas de grabación independientes, cada una **AMBIENT** o **VOCAL**. |
| Mezclador | Por canal solo: **HP**, **LP**, **PAN** y volumen (+ mute/solo). Doble clic restaura un control. |

## Grabar

1. Pulsa **REC** (o la tecla `1`–`4`) en una pista. Se abre el micrófono, se arma y **empieza en el próximo compás**. El micrófono **solo está abierto mientras grabas** y se cierra unos segundos después de recoger la toma (el botón **MIC** de la cabecera lo abre o lo cierra a mano).
2. Púlsalo otra vez: **termina en el siguiente compás**. (Si en LOOP eliges 1/2/4/8 compases, se cierra solo.)
3. La toma se procesa y suena en loop, sincronizada con la rejilla. Si cambias el BPM, los loops van "a cinta" (mismo compás, otro tono).

### AMBIENT
El loop recorre la grabación de principio a fin y se le aplica un ambiente generado **una sola vez por grabación** (no en cada repetición):
glitch (stutter, reversa, tape-stop, freeze, drops, crush, shuffle), nube granular y drones, filtro que se mueve, saturación, delay en ping-pong y reverb larga y oscura.
Esa "personalidad" sale de una semilla (`#XXXX` en la etiqueta de la pista) y **se mantiene para siempre** en esa grabación. Para otro ambiente, vuelve a grabar.

El selector **FX ×** de la pista deja que el ciclo de esos efectos sea ½, 1, 2 o 4 veces la duración del loop (p. ej. un loop de 2 compases con los efectos evolucionando durante 8). Los primeros compases suenan igual al cambiar el ciclo: solo "continúa" más allá.

### VOCAL
Trata la toma como voz: **gate** adaptativo (calcula el umbral con el ruido de la propia toma), **afinación suave a la tonalidad** del proyecto (KEY, por defecto La menor), **compresión**, EQ de voz y una sala corta. Si cambias la KEY, las voces se vuelven a afinar.

## Privacidad

- El micrófono **solo se abre cuando grabas** y **solo se usa internamente**: va a un medidor y a un grabador en memoria; no está conectado a la salida.
- Las grabaciones viven únicamente en la memoria de la pestaña: no se guardan ni se envían a ningún sitio.
- Solo se recuerdan en tu navegador los patrones y la mezcla.

## Audio: altavoces, auriculares de cable o Bluetooth

La app programa el audio con antelación, así que **no necesita latencia mínima**. Por eso trabaja por defecto con un buffer **ESTABLE (~85 ms)**: absorbe cualquier microparón del ordenador o de los drivers. (El Bluetooth añade su propio buffer, y por eso antes se oía bien solo con él.)

Botón **⚙** junto al micrófono (panel AUDIO):

| Ajuste | Para qué |
|---|---|
| **SALIDA** | Lectura de la frecuencia de muestreo y la latencia reales. Si el dispositivo va a 96/192 kHz, el motor se fija a 48 kHz. |
| **BUFFER** | **MÍN** (10 ms) · **ESTABLE** (por defecto) · **MÁX** (~210 ms). Si con altavoces o cable oyes chasquidos o cortes, prueba **MÁX**. Cambiarlo reinicia el audio (se pierden las grabaciones actuales; patrones y mezcla se conservan). |
| **ECO MIC** | Con **altavoces**, el micro recoge el ritmo que suena. **ON** lo quita de la grabación. Con auriculares déjalo en OFF. |

### Si TODO el ordenador suena raro (sin agudos, "pobre", como un cable que falla) con la app abierta

No lo causa el audio de la página (una web no puede cambiar el sonido de otros programas): lo causa **abrir el micrófono**. Algunos equipos, al abrir un micro, pasan la tarjeta de sonido a un modo "llamada" (filtro de agudos y cancelación de eco/ruido) que afecta a todo el sonido. Por eso:

- La app **ya no abre el micrófono al entrar**: solo al pulsar REC, y lo cierra al terminar. Puedes hacer ritmos y bajos con el sonido normal; compruébalo mirando que el botón de la cabecera diga **MIC OFF**.
- Si al grabar notas el cambio, prueba en Windows: *Configuración → Sistema → Sonido* → tu micrófono y tu salida → **Mejoras de audio: desactivadas**; *Panel de control → Sonido → Comunicaciones → "No hacer nada"*; y desactiva los perfiles de voz / cancelación de ruido / eco del software de tu tarjeta (Realtek, Dolby, Waves, Nahimic…).
- En el selector del micrófono de la cabecera elige un dispositivo concreto en vez de "Predeterminado". Si tus auriculares de cable tienen micro (jack de 4 contactos), el conector puede cambiar de modo al abrirlo: usa el micro del portátil u otro.

Además: la salida lleva un filtro subsónico (24 Hz) y más margen de nivel para no castigar altavoces pequeños, y si enchufas o desenchufas auriculares con la app abierta, el audio se reengancha solo a la salida predeterminada.

## Atajos

`Espacio` play/stop · `1`–`4` REC 1–4 · `Esc` cierra paneles · `?` abre la guía dentro de la app.

## Para curiosos

```
index.html            estructura
css/style.css         el aspecto
js/dsp.js             DSP puro: ambiente, voz, afinación (corre en un Worker)
js/engine.js          grafo de audio, buffer/sample rate, micrófono, grabador en streaming (AudioWorklet), workers
js/sequencer.js       reloj maestro, swing/humanize/groove, looper
js/synth.js           kick, clap, snare, hats y bajo
js/roll.js            piano roll
js/lanes.js · mixer.js · widgets.js · app.js    interfaz
serve.js · INICIAR.bat                          servidor local y lanzador
tests/dsp-selftest.js   node tests/dsp-selftest.js  (24 comprobaciones del DSP)
tests/voices.html       mide los sintes (pico, RMS, espectro) en el navegador
```

El nombre está en `js/core.js` (`NRB.APP_NAME`), en el `<title>` y en la "puerta" de `index.html`.
