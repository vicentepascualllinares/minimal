# Pendiente: el sonido del ordenador se degrada con el micrófono abierto

## Qué pasa (confirmado por el usuario)
- Con **MIC OFF** todo suena normal.
- Con **MIC ON** (micrófono abierto) *todo el ordenador* suena sin agudos, "pobre", como un filtro paso-bajo con cancelación (como un cable que falla).
- Ocurre con **auriculares de cable** y con los **altavoces del ordenador**. Con **auriculares Bluetooth NO** ocurre.

## Lo que ya sabemos
- **No es el audio de la app.** El micro no está conectado a la salida (verificado: con el micro recibiendo señal y la app parada, la salida del máster marca 0).
- Afecta a todo el sistema, así que es una reacción de **Windows / del driver de la tarjeta de sonido** al abrir un micrófono (modo "llamada": filtro + cancelación de eco/ruido, o cambio de formato/frecuencia). Con Bluetooth no pasa porque el micro abierto es otro dispositivo.
- Ya mitigado: el micro **no se abre al entrar**; solo al pulsar REC, y se cierra ~5 s después de recoger la toma (el botón MIC de la cabecera lo mantiene abierto). **Mientras se graba sigue pudiendo degradarse.**
- `getUserMedia` se pide con: `echoCancellation:false, noiseSuppression:false, autoGainControl:false, channelCount:{ideal:1}`.
- El panel ⚙ AUDIO tiene una línea **MIC** que muestra cómo lo abrió realmente el navegador (dispositivo, kHz, canales, eco). Si sale ≤16 kHz, el equipo lo abre en formato de llamada.

## Pruebas para la próxima sesión (en este orden)
1. **¿Pasa con otra web que use el micro** (un test de micrófono online, Google Meet) o con la Grabadora de Windows? Si sí → es de Windows/driver y la app no puede evitarlo (solo documentarlo).
2. **¿Pasa en Firefox?** Firefox abre el micrófono de otra forma que Chrome/Edge. Si en Firefox no → es cómo Chrome lo abre en este equipo.
3. Con MIC ON, abrir ⚙ AUDIO y apuntar la línea **MIC** (kHz y canales).
4. Windows: *Sonido → Entrada y Salida → Mejoras de audio* desactivadas; *Panel de control → Sonido → Comunicaciones → No hacer nada*; propiedades del micro → *Avanzado* → formato 48000 Hz y sin modo exclusivo; desactivar perfiles de voz / cancelación de ruido del software de la tarjeta (Realtek, Dolby, Waves, Nahimic).
5. Probar otro dispositivo de entrada concreto (no "Predeterminado") u otro micro (por ejemplo USB).

## Opciones si no hay arreglo por software
- Grabar con los auriculares Bluetooth (con ellos no se degrada) y hacer ritmos con cable/altavoces.
- Añadir **importar audio** (arrastrar un archivo a una pista REC) para no abrir nunca el micro.
- Mostrar el selector de micrófono también con el micro cerrado y abrir el micro solo justo antes del compás de entrada.
