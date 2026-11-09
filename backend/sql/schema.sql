-- =============================================================================
-- PayLink HN — Fase 2: Catálogo, Carrito y Pedidos
-- Motor: MariaDB 10.11+
-- =============================================================================
-- Este script asume que la base de datos y el usuario YA existen (los creaste
-- tú al instalar MariaDB). Si necesitas recrearlos, estos son los comandos
-- equivalentes a los que ya ejecutaste (referencia, no hace falta repetirlos):
--
--   CREATE DATABASE paylink_db CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
--   CREATE USER 'paylink_usr'@'localhost' IDENTIFIED BY 'tu_contraseña_segura';
--   GRANT ALL PRIVILEGES ON paylink_db.* TO 'paylink_usr'@'localhost';
--   FLUSH PRIVILEGES;
--
-- Ejecución:
--   mariadb -u paylink_usr -p paylink_db < schema.sql
-- =============================================================================

USE paylink_db;

SET NAMES utf8mb4;

-- -----------------------------------------------------------------------------
-- 1) Categorias
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS Categorias (
    id_categoria    INT UNSIGNED        NOT NULL AUTO_INCREMENT,
    nombre          VARCHAR(100)        NOT NULL,
    descripcion     VARCHAR(255)        NULL,
    activo          TINYINT(1)          NOT NULL DEFAULT 1,

    PRIMARY KEY (id_categoria),
    -- Evita dos categorías activas con el mismo nombre (p. ej. dos "Bebidas").
    UNIQUE KEY uq_categorias_nombre (nombre),
    KEY idx_categorias_activo (activo)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- 2) Productos
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS Productos (
    id_producto         INT UNSIGNED        NOT NULL AUTO_INCREMENT,
    id_categoria        INT UNSIGNED        NOT NULL,
    nombre              VARCHAR(150)        NOT NULL,
    descripcion         VARCHAR(255)        NULL,
    -- DECIMAL, nunca FLOAT/DOUBLE: el dinero no se representa en coma flotante.
    precio              DECIMAL(10,2)       NOT NULL,
    imagen_url          VARCHAR(500)        NULL,
    disponible          TINYINT(1)          NOT NULL DEFAULT 1,
    -- Contador de ventas acumuladas. Lo incrementa el backend en cada pedido
    -- pagado (ver routes/payments.js); es la base de datos para la futura IA
    -- de recomendaciones ("los más vendidos", "sugerencias por categoría"…).
    cantidad_vendida    INT UNSIGNED        NOT NULL DEFAULT 0,

    PRIMARY KEY (id_producto),
    CONSTRAINT fk_productos_categoria
        FOREIGN KEY (id_categoria) REFERENCES Categorias (id_categoria)
        ON UPDATE CASCADE
        -- RESTRICT: no se puede borrar una categoría mientras tenga productos.
        -- Para "eliminar" un producto o una categoría del menú, usa el flag
        -- (disponible=0 / activo=0) en vez de un DELETE: así el historial de
        -- Detalle_Pedido conserva una referencia válida.
        ON DELETE RESTRICT,
    CHECK (precio >= 0),

    KEY idx_productos_categoria (id_categoria),
    KEY idx_productos_disponible (disponible)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- 3) Pedidos
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS Pedidos (
    id_pedido           INT UNSIGNED        NOT NULL AUTO_INCREMENT,
    fecha_hora          DATETIME            NOT NULL DEFAULT CURRENT_TIMESTAMP,
    -- VARCHAR y no INT: así admite "Mostrador" o "Para llevar" además de un
    -- número de mesa, sin forzar una columna aparte para el modo de entrega.
    numero_mesa         VARCHAR(20)         NOT NULL,
    -- Total que se cobró realmente (snapshot). Lo calcula el backend a partir
    -- de los precios vigentes en Productos al momento del pedido; nunca se
    -- confía en un total enviado por el cliente (ver nota de seguridad en el
    -- mensaje de esta entrega).
    total               DECIMAL(10,2)       NOT NULL,
    estado              ENUM(
                            'Pendiente',        -- creado pero sin pago confirmado (no usado en el flujo actual)
                            'Pagado',           -- pago aprobado por el gateway; estado con el que se inserta hoy
                            'En Preparación',   -- la cocina lo tomó (lo moverá un futuro endpoint de cocina)
                            'Listo',
                            'Entregado',
                            'Cancelado'
                        )                       NOT NULL DEFAULT 'Pendiente',
    -- Referencia de la transacción en el gateway de pagos (p. ej. "mock_..."
    -- o el id de un PaymentIntent de Stripe). A propósito NO se guarda aquí
    -- el token cifrado crudo de Google Pay (ver nota de seguridad adjunta).
    token_pago_gpay     VARCHAR(128)        NULL,

    PRIMARY KEY (id_pedido),
    CHECK (total >= 0),

    KEY idx_pedidos_estado (estado),
    KEY idx_pedidos_fecha_hora (fecha_hora)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- 4) Detalle_Pedido
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS Detalle_Pedido (
    id_detalle          INT UNSIGNED        NOT NULL AUTO_INCREMENT,
    id_pedido           INT UNSIGNED        NOT NULL,
    id_producto         INT UNSIGNED        NOT NULL,
    cantidad             INT UNSIGNED        NOT NULL,
    -- Precio AL MOMENTO del pedido (copia, no referencia). Si mañana cambia
    -- Productos.precio, los pedidos históricos deben seguir mostrando lo que
    -- el cliente realmente pagó.
    precio_unitario      DECIMAL(10,2)       NOT NULL,

    PRIMARY KEY (id_detalle),
    CONSTRAINT fk_detalle_pedido
        FOREIGN KEY (id_pedido) REFERENCES Pedidos (id_pedido)
        ON UPDATE CASCADE
        ON DELETE CASCADE,  -- si se borra un pedido, su detalle se borra con él
    CONSTRAINT fk_detalle_producto
        FOREIGN KEY (id_producto) REFERENCES Productos (id_producto)
        ON UPDATE CASCADE
        ON DELETE RESTRICT, -- conserva el historial: no se puede borrar un producto ya vendido
    CHECK (cantidad > 0),
    CHECK (precio_unitario >= 0),

    KEY idx_detalle_pedido (id_pedido),
    KEY idx_detalle_producto (id_producto)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
