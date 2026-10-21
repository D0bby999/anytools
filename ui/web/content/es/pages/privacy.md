---
title: Política de privacidad
description: Las herramientas funcionan en tu navegador y no nos envían nada. La app de estudio guarda lo que tú guardas y usa la IA solo a través de las cuentas que conectas.
updated: 2026-10-21
---

## Resumen

AnyTools tiene dos partes, y cada una trata tus datos de forma distinta.

- **Las herramientas** funcionan en tu navegador. El JSON que pegas, los archivos que abres y las contraseñas que generas se quedan en tu dispositivo. No necesitan cuenta, y nada de lo que introduces nos llega, salvo las dos excepciones de abajo.
- **La app de estudio** se abre cuando inicias sesión con Google o GitHub. Guarda lo que tú decides guardar en ella. Usa modelos de IA y búsqueda web solo a través de las cuentas y claves que tú mismo conectas.

No usamos analítica, anuncios, rastreadores ni grabación de sesiones, en ninguna de las dos partes.

## Las herramientas

Lo que introduces en una herramienta lo procesa JavaScript en tu navegador. No tenemos copia de lo que formateaste, convertiste, generaste o comprobaste.

Dos herramientas necesitan nuestro servidor:

- el **conversor de curl a código** envía el comando que pegas a nuestro servidor, que lo analiza, devuelve el código y descarta el comando sin registrarlo;
- el **conversor de divisas** pide los tipos de cambio a nuestro servidor. La petición solo nombra las monedas, y tus importes se quedan en tu navegador. El servidor toma los tipos de Frankfurter, que publica los tipos de referencia del Banco Central Europeo.

## La app de estudio

Cuando inicias sesión, guardamos:

- tu dirección de correo y tu nombre visible, de Google o GitHub, para reconocerte;
- lo que añades y creas: los documentos y archivos que subes, notas, cuestionarios y tus respuestas, historial de repaso, fichas de trabajo, grabaciones y el resto de tu material de estudio;
- las conexiones de IA y de búsqueda que añades. Sus claves se cifran antes de guardarse, nunca se te muestran completas y no aparecen en los registros.

Tus archivos se guardan en nuestro servidor, o en tu propio Google Drive si lo eliges en Ajustes.

Cuando una función necesita un modelo o una búsqueda web, la petición va al proveedor que conectaste, con tu clave y bajo sus condiciones. Las partes de tu material que la petición necesita viajan con ella. AnyTools no tiene clave de IA propia y no envía tu material a ningún otro proveedor.

Algunas funciones descargan páginas públicas cuando se lo pides: una página web, un vídeo o un feed que añades, datos de artículos de OpenAlex y elementos de tu biblioteca de Zotero cuando la conectas.

## Apps conectadas

Tú eliges qué apps conectar en Apps de estudio, y puedes desconectar cada una allí cuando quieras. Desconectar revoca el acceso de AnyLearn en la app; lo que ya importaste se queda en AnyLearn hasta que lo borres.

- **Google Drive** (`drive.file`): AnyLearn abre solo los archivos que eliges en el selector de Google y los que crea para ti (tus archivos guardados, exportaciones y documentos para NotebookLM). No ve el resto de tu Drive.
- **Google Calendar** (`calendar.app.created`): AnyLearn crea un calendario propio, llamado AnyLearn, y escribe en él tus horas de repaso y días de estudio. No puede leer tus otros calendarios.
- **Google Classroom** (solo lectura: tus clases, sus materiales, tus propias tareas y los anuncios): AnyLearn lista una clase cuando la abres e importa solo lo que marcas. Nunca publica, entrega ni cambia nada en Classroom.
- **Google Fotos** (solo el selector): AnyLearn recibe solo las fotos que eliges en el selector de Google, una vez, y las lee como fotos de páginas.
- **Google Forms y Hojas de cálculo**: con el permiso de Drive de arriba, AnyLearn abre solo el formulario o la hoja que eliges, y crea formularios solo cuando lo pides.
- **Correo entrante**: el correo que envías o reenvías a tu dirección de AnyLearn se convierte en documentos. AnyLearn nunca lee tu buzón ni pide permisos de Gmail.
- **Canva** y **Notion**: AnyLearn lee solo los diseños que eliges y las páginas que compartes con él en Notion, y escribe solo lo que envías allí.

El uso y la transferencia a cualquier otra app, por parte de AnyLearn, de la información recibida de las API de Google cumplirá la [Política de datos de usuario de los servicios de API de Google](https://developers.google.com/terms/api-services-user-data-policy), incluidos los requisitos de Uso Limitado. Los datos de Google, Canva y Notion se usan solo para ofrecer las funciones que activaste: no se venden, no se usan para publicidad ni para entrenar modelos de IA, y nadie los lee salvo para resolver un problema que informes, con tu consentimiento. Los tokens de estas apps se cifran antes de guardarse.

## Cookies y almacenamiento

Las herramientas no ponen cookies. Tu tema claro u oscuro se guarda en el almacenamiento local de tu navegador.

La app de estudio pone una cookie de sesión cuando inicias sesión, y una cookie de corta duración durante el propio inicio de sesión. Ambas son necesarias para que la app funcione, y ninguna te sigue a ningún otro sitio.

## Borrar tus datos

Ajustes → Cuenta borra tu cuenta y todo lo que contiene. Antes se revoca el acceso que diste a Google Drive. Los archivos de tu propio Google Drive se quedan allí: son tuyos y no los borramos.

## Terceros

Alojamiento: Hetzner (Alemania, UE). Red y DNS: Cloudflare. Inicio de sesión: Google y GitHub. IA y búsqueda: solo los proveedores que conectas. Apps de estudio: Google, Canva y Notion, solo las que conectas; el correo entrante llega por Cloudflare Email Routing. Cada uno opera bajo su propia política de privacidad.

## Tus derechos

Puedes pedir una copia de los datos que tenemos sobre ti, su corrección o su borrado escribiendo a support@anytools.world. Respondemos en 30 días. Los residentes en la UE tienen derechos adicionales según el RGPD, los de Vietnam según su ley de protección de datos personales y los de California según la CCPA.

## Menores

AnyTools no está dirigida a menores de 13 años, y no recopilamos sus datos a sabiendas. Si crees que un menor nos ha dado información, contáctanos y la borraremos.

## Cambios

Actualizamos esta política cuando cambia el producto. La fecha de arriba indica el último cambio.

## Contacto

Correo: support@anytools.world.

AnyTools está operada por Cassau, LLC, una sociedad de responsabilidad limitada de Delaware. Agente registrado: Legalinc Corporate Services Inc., 131 Continental Dr, Suite 305, Newark, DE 19713, USA.
