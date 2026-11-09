-- =============================================================================
-- PayLink HN — datos de ejemplo (OPCIONAL)
-- Solo para probar GET /api/catalog sin cargar productos a mano.
-- Ejecutar DESPUÉS de schema.sql:   mariadb -u paylink_usr -p paylink_db < seed.sql
-- =============================================================================

USE paylink_db;

SET NAMES utf8mb4;

INSERT INTO Categorias (nombre, descripcion, activo) VALUES
    ('Platos Fuertes', 'Comida típica hondureña',           1),
    ('Bebidas',        'Frías y calientes',                 1),
    ('Postres',        'Para cerrar con algo dulce',         1);

INSERT INTO Productos (id_categoria, nombre, descripcion, precio, imagen_url, disponible) VALUES
    ((SELECT id_categoria FROM Categorias WHERE nombre = 'Platos Fuertes'),
     'Baleada sencilla', 'Tortilla de harina, frijoles, queso y mantequilla', 35.00, NULL, 1),
    ((SELECT id_categoria FROM Categorias WHERE nombre = 'Platos Fuertes'),
     'Baleada especial', 'Con pollo, aguacate y chimol',                      55.00, NULL, 1),
    ((SELECT id_categoria FROM Categorias WHERE nombre = 'Platos Fuertes'),
     'Plato típico',     'Carne asada, frijoles, plátano, queso y crema',     120.00, NULL, 1),
    ((SELECT id_categoria FROM Categorias WHERE nombre = 'Bebidas'),
     'Limonada',         'Natural, jarra de 500ml',                           30.00, NULL, 1),
    ((SELECT id_categoria FROM Categorias WHERE nombre = 'Bebidas'),
     'Café de olla',      'Molido, recién hecho',                             25.00, NULL, 1),
    ((SELECT id_categoria FROM Categorias WHERE nombre = 'Bebidas'),
     'Horchata',          'Bebida fría a base de arroz y canela',             28.00, NULL, 1),
    ((SELECT id_categoria FROM Categorias WHERE nombre = 'Bebidas'),
     'Agua embotellada',  '600ml',                                            15.99, NULL, 1),
    ((SELECT id_categoria FROM Categorias WHERE nombre = 'Postres'),
     'Tres leches',       'Porción individual',                               45.00, NULL, 1),
    ((SELECT id_categoria FROM Categorias WHERE nombre = 'Postres'),
     'Rosquillas',        'Bolsa de 6 unidades',                              20.00, NULL, 1);
