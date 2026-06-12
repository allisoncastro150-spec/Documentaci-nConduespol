# DOCUCONDUESPOL Platform

Plataforma empresarial para gestionar documentos por codigo unico, fecha, usuario y departamento.

## Que incluye

- Interfaz web empresarial con logo.
- Login y roles preparados para `admin` y `user`.
- Modelo PostgreSQL para usuarios, departamentos, documentos y auditoria.
- Subida de multiples tipos de archivo, no solo PDF.
- Generacion de codigo unico por departamento y fecha.
- Busqueda por codigo, palabra clave, departamento y rango de fechas.
- Estructura lista para conectar almacenamiento local o almacenamiento cloud.

## Logo de la empresa

Coloca el logo real en:

```txt
public/logo.png
```

Si no existe, la plataforma muestra el placeholder incluido.

## Instalacion

```bash
npm install
copy .env.example .env
```

Crea una base PostgreSQL llamada `docuconduespol` y ejecuta:

```bash
psql -d docuconduespol -f database/schema.sql
psql -d docuconduespol -f database/seed.sql
```

Despues inicia:

```bash
npm run dev
```

Abre:

```txt
http://localhost:3000
```

## Siguiente fase recomendada

Para produccion conviene mover esta base a Next.js + Prisma, mantener este mismo diseno visual y conectar autenticacion real con sesiones seguras.

## Usuarios iniciales

```txt
admin / admin2026
secretaria01 / Temp2026
```

## Despliegue web

La app ya tiene `render.yaml` y usa `npm start`, por lo que se puede desplegar como Web Service de Node.js.

Para una demo web simple:

```txt
Build command: npm install
Start command: npm start
```

Para produccion empresarial real, usa PostgreSQL y almacenamiento persistente para los archivos.
