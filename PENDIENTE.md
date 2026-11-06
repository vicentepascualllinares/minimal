# Pendiente: apagar la reducción de ruido "de llamadas" del portátil

## Causa (encontrada y medida el 6-nov-2026)
No es la app. El servicio de audio de Realtek de este Acer (`RtkAudUService64.exe`, personalización Acer)
tiene una lista fija de "apps de llamadas" (`chrome.exe`, `msedge.exe`, `firefox.exe`, `opera.exe`, Teams,
Zoom, Skype, Discord…). Si una de ellas **reproduce sonido con el micro abierto**, activa la reducción de
ruido IA en la **salida** (Acer Purified Voice): la música suena apagada y con cancelación en todo el equipo
(altavoces y auriculares de cable; el Bluetooth no). Detalles y pruebas: README → "Si al grabar todo suena apagado".

## Falta (una vez, en el portátil)
1. Abrir **Acer Purified Voice Console** → apagar **Speaker AI noise reduction (Voice Call)**
   (según versión: *Audio output AI noise reduction*).
2. Comprobar: app en Chrome → play → REC. Con **MIC ON** la música debe sonar igual que con MIC OFF.
3. Si se confirma, borrar este archivo. Si una actualización del driver lo vuelve a activar, repetir el paso 1.

Alternativas si no se quiere tocar ese ajuste: grabar con una interfaz de audio USB, o usar Brave o Vivaldi
(no están en la lista de Realtek).
