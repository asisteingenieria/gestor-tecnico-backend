const db = require('../config/db');

function calcularTipo(valor) {
    if (valor === null || valor === undefined || valor === '') return null;
    return parseFloat(valor) >= 400000 ? 'activo' : 'gasto';
}

class Activo {
    static async getAll() {
        try {
            const [rows] = await db.query(`
                SELECT
                    a.*,
                    u.full_name as created_by_name,
                    ag.nombres   AS agente_nombres,
                    ag.apellidos AS agente_apellidos,
                    ag.campana   AS agente_campana
                FROM activos a
                LEFT JOIN users   u  ON a.created_by_id = u.id
                LEFT JOIN agentes ag ON a.agente_id      = ag.id
                ORDER BY a.created_at DESC
            `);
            return rows;
        } catch (error) {
            throw error;
        }
    }

    static async getById(id) {
        try {
            const [rows] = await db.query(`
                SELECT
                    a.*,
                    u.full_name as created_by_name,
                    ag.nombres   AS agente_nombres,
                    ag.apellidos AS agente_apellidos,
                    ag.campana   AS agente_campana
                FROM activos a
                LEFT JOIN users   u  ON a.created_by_id = u.id
                LEFT JOIN agentes ag ON a.agente_id      = ag.id
                WHERE a.id = ?
            `, [id]);
            return rows[0];
        } catch (error) {
            throw error;
        }
    }

    static async create(activoData, createdById) {
        try {
            const {
                numero_placa,
                centro_costes,
                ubicacion,
                responsable,
                proveedor,
                valor,
                fecha_compra,
                numero_social,
                poliza,
                aseguradora,
                garantia,
                fecha_vencimiento_garantia,
                orden_compra,
                clasificacion,
                clasificacion_activo_fijo,
                adjunto_archivo,
                site,
                puesto,
                asignado,
                marca_modelo,
                numero_serie_fabricante,
                cpu_procesador,
                memoria_ram,
                almacenamiento,
                sistema_operativo,
                pulgadas,
                estado,
                agente_id
            } = activoData;

            // Validar que el número de placa no existe
            const [existingActivo] = await db.query('SELECT id FROM activos WHERE numero_placa = ?', [numero_placa]);
            if (existingActivo.length > 0) {
                throw new Error(`El número de placa '${numero_placa}' ya existe en el sistema`);
            }

            // Validar que si garantia es 'Si', debe tener fecha_vencimiento_garantia
            if (garantia === 'Si' && !fecha_vencimiento_garantia) {
                throw new Error('La fecha de vencimiento de garantía es requerida cuando la garantía es "Sí"');
            }

            // Validar que si garantia es 'No', no debe tener fecha_vencimiento_garantia
            if (garantia === 'No' && fecha_vencimiento_garantia) {
                throw new Error('No debe especificar fecha de vencimiento de garantía cuando la garantía es "No"');
            }

            // Determinar tipo de activo automáticamente
            // Patrón esperado: ECC-CPU-001 o ECC'CPU'001 (pistola códigos lee guión como comilla)
            let tipo_activo = 'OTHER';
            if (numero_placa) {
                const placa = numero_placa.toUpperCase();
                
                // Detectar patrones completos con guión o comilla simple y consecutivo
                if (placa.match(/^ECC[-']CPU[-']\d+$/)) tipo_activo = 'ECC-CPU';
                else if (placa.match(/^ECC[-']SER[-']\d+$/)) tipo_activo = 'ECC-SER';
                else if (placa.match(/^ECC[-']MON[-']\d+$/)) tipo_activo = 'ECC-MON';
                else if (placa.match(/^ECC[-']IMP[-']\d+$/)) tipo_activo = 'ECC-IMP';
                else if (placa.match(/^ECC[-']POR[-']\d+$/)) tipo_activo = 'ECC-POR';
                else if (placa.match(/^ECC[-']TV[-']\d+$/)) tipo_activo = 'ECC-TV';
                // También detectar prefijos mientras se escribe
                else if (placa.startsWith('ECC-CPU') || placa.startsWith("ECC'CPU")) tipo_activo = 'ECC-CPU';
                else if (placa.startsWith('ECC-SER') || placa.startsWith("ECC'SER")) tipo_activo = 'ECC-SER';
                else if (placa.startsWith('ECC-MON') || placa.startsWith("ECC'MON")) tipo_activo = 'ECC-MON';
                else if (placa.startsWith('ECC-IMP') || placa.startsWith("ECC'IMP")) tipo_activo = 'ECC-IMP';
                else if (placa.startsWith('ECC-POR') || placa.startsWith("ECC'POR")) tipo_activo = 'ECC-POR';
                else if (placa.startsWith('ECC-TV') || placa.startsWith("ECC'TV")) tipo_activo = 'ECC-TV';
            }

            const tipo = calcularTipo(valor);

            const [result] = await db.query(`
                INSERT INTO activos (
                    numero_placa, centro_costes, ubicacion, empresa, responsable,
                    proveedor, valor, tipo, agente_id, fecha_compra, numero_social, poliza, aseguradora,
                    garantia, fecha_vencimiento_garantia, orden_compra, clasificacion,
                    clasificacion_activo_fijo, adjunto_archivo, created_by_id, tipo_activo,
                    site, puesto, asignado, marca_modelo, numero_serie_fabricante, cpu_procesador, memoria_ram,
                    almacenamiento, sistema_operativo, pulgadas, estado
                ) VALUES (?, ?, ?, 'Asiste', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `, [
                numero_placa, centro_costes, ubicacion, responsable,
                proveedor, valor || null, tipo, agente_id || null, fecha_compra, numero_social, poliza, aseguradora,
                garantia, fecha_vencimiento_garantia || null, orden_compra, clasificacion,
                clasificacion_activo_fijo, adjunto_archivo, createdById, tipo_activo,
                site || null, puesto || null, asignado || null, marca_modelo || null, numero_serie_fabricante || null, cpu_procesador || null,
                memoria_ram || null, almacenamiento || null, sistema_operativo || null,
                pulgadas || null, estado || 'funcional'
            ]);

            return { id: result.insertId, ...activoData };
        } catch (error) {
            throw error;
        }
    }

    static async update(id, activoData) {
        try {
            const {
                numero_placa,
                centro_costes,
                ubicacion,
                responsable,
                proveedor,
                valor,
                fecha_compra,
                numero_social,
                poliza,
                aseguradora,
                garantia,
                fecha_vencimiento_garantia,
                orden_compra,
                clasificacion,
                clasificacion_activo_fijo,
                adjunto_archivo,
                site,
                puesto,
                asignado,
                marca_modelo,
                numero_serie_fabricante,
                cpu_procesador,
                memoria_ram,
                almacenamiento,
                sistema_operativo,
                pulgadas,
                estado,
                agente_id
            } = activoData;

            // Validar que el número de placa no existe en otro activo
            const [existingActivo] = await db.query('SELECT id FROM activos WHERE numero_placa = ? AND id != ?', [numero_placa, id]);
            if (existingActivo.length > 0) {
                throw new Error(`El número de placa '${numero_placa}' ya existe en el sistema`);
            }

            // Validar que si garantia es 'Si', debe tener fecha_vencimiento_garantia
            if (garantia === 'Si' && !fecha_vencimiento_garantia) {
                throw new Error('La fecha de vencimiento de garantía es requerida cuando la garantía es "Sí"');
            }

            // Validar que si garantia es 'No', no debe tener fecha_vencimiento_garantia
            if (garantia === 'No' && fecha_vencimiento_garantia) {
                throw new Error('No debe especificar fecha de vencimiento de garantía cuando la garantía es "No"');
            }

            // Determinar tipo de activo automáticamente si cambió el número de placa
            // Patrón esperado: ECC-CPU-001 o ECC'CPU'001 (pistola códigos lee guión como comilla)
            let tipo_activo = 'OTHER';
            if (numero_placa) {
                const placa = numero_placa.toUpperCase();
                
                // Detectar patrones completos con guión o comilla simple y consecutivo
                if (placa.match(/^ECC[-']CPU[-']\d+$/)) tipo_activo = 'ECC-CPU';
                else if (placa.match(/^ECC[-']SER[-']\d+$/)) tipo_activo = 'ECC-SER';
                else if (placa.match(/^ECC[-']MON[-']\d+$/)) tipo_activo = 'ECC-MON';
                else if (placa.match(/^ECC[-']IMP[-']\d+$/)) tipo_activo = 'ECC-IMP';
                else if (placa.match(/^ECC[-']POR[-']\d+$/)) tipo_activo = 'ECC-POR';
                else if (placa.match(/^ECC[-']TV[-']\d+$/)) tipo_activo = 'ECC-TV';
                // También detectar prefijos mientras se escribe
                else if (placa.startsWith('ECC-CPU') || placa.startsWith("ECC'CPU")) tipo_activo = 'ECC-CPU';
                else if (placa.startsWith('ECC-SER') || placa.startsWith("ECC'SER")) tipo_activo = 'ECC-SER';
                else if (placa.startsWith('ECC-MON') || placa.startsWith("ECC'MON")) tipo_activo = 'ECC-MON';
                else if (placa.startsWith('ECC-IMP') || placa.startsWith("ECC'IMP")) tipo_activo = 'ECC-IMP';
                else if (placa.startsWith('ECC-POR') || placa.startsWith("ECC'POR")) tipo_activo = 'ECC-POR';
                else if (placa.startsWith('ECC-TV') || placa.startsWith("ECC'TV")) tipo_activo = 'ECC-TV';
            }

            const tipo = calcularTipo(valor);

            const [result] = await db.query(`
                UPDATE activos SET
                    numero_placa = ?, centro_costes = ?, ubicacion = ?, responsable = ?,
                    proveedor = ?, valor = ?, tipo = ?, agente_id = ?, fecha_compra = ?, numero_social = ?, poliza = ?,
                    aseguradora = ?, garantia = ?, fecha_vencimiento_garantia = ?,
                    orden_compra = ?, clasificacion = ?, clasificacion_activo_fijo = ?,
                    adjunto_archivo = ?, tipo_activo = ?, site = ?, puesto = ?, asignado = ?, marca_modelo = ?, numero_serie_fabricante = ?,
                    cpu_procesador = ?, memoria_ram = ?, almacenamiento = ?, sistema_operativo = ?,
                    pulgadas = ?, estado = ?, updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
            `, [
                numero_placa, centro_costes, ubicacion, responsable,
                proveedor, valor || null, tipo, agente_id || null, fecha_compra, numero_social, poliza, aseguradora,
                garantia, fecha_vencimiento_garantia || null, orden_compra,
                clasificacion, clasificacion_activo_fijo, adjunto_archivo, tipo_activo,
                site || null, puesto || null, asignado || null, marca_modelo || null, numero_serie_fabricante || null, cpu_procesador || null,
                memoria_ram || null, almacenamiento || null, sistema_operativo || null,
                pulgadas || null, estado || 'funcional', id
            ]);

            return result.affectedRows > 0;
        } catch (error) {
            throw error;
        }
    }

    static async delete(id) {
        try {
            const [result] = await db.query('DELETE FROM activos WHERE id = ?', [id]);
            return result.affectedRows > 0;
        } catch (error) {
            throw error;
        }
    }

    static async getByFilter(filters) {
        try {
            let query = `
                SELECT 
                    a.*,
                    u.full_name as created_by_name
                FROM activos a
                LEFT JOIN users u ON a.created_by_id = u.id
                WHERE 1=1
            `;
            const params = [];

            if (filters.numero_placa) {
                // Normalizar búsqueda: convertir comillas a guiones para compatibilidad con pistola
                const normalizedSearch = filters.numero_placa.replace(/'/g, '-');
                query += ' AND (a.numero_placa LIKE ? OR a.numero_placa LIKE ?)';
                params.push(`%${filters.numero_placa}%`);
                params.push(`%${normalizedSearch}%`);
            }

            if (filters.ubicacion) {
                query += ' AND a.ubicacion = ?';
                params.push(filters.ubicacion);
            }

            if (filters.responsable) {
                query += ' AND a.responsable LIKE ?';
                params.push(`%${filters.responsable}%`);
            }

            if (filters.asignado) {
                query += ' AND a.asignado LIKE ?';
                params.push(`%${filters.asignado}%`);
            }

            if (filters.clasificacion) {
                query += ' AND a.clasificacion = ?';
                params.push(filters.clasificacion);
            }

            if (filters.garantia) {
                query += ' AND a.garantia = ?';
                params.push(filters.garantia);
            }

            if (filters.sin_agente === 'true') {
                query += ' AND a.agente_id IS NULL';
            }

            query += ' ORDER BY a.created_at DESC';

            const [rows] = await db.query(query, params);
            return rows;
        } catch (error) {
            throw error;
        }
    }

    static async getResponsables() {
        try {
            return [
                "ANGELA JEANNETH JIMENEZ C.C. 1026555251",
                "NELSON DAVID ACERO CANTOR C.C. 80767085",
                "ANDRES SANTIAGO NUNCIRA JIMENEZ C.C. 1014303558",
                "GIOVANNY ALFREDO OSPINA CORREA",
                "DAVID EDUARDO LOPEZ CUARTAS C.C. 1026583349"
            ];
        } catch (error) {
            throw error;
        }
    }

    static async getStats() {
        try {
            const [totalRows] = await db.query('SELECT COUNT(*) as total FROM activos');
            const [productivoRows] = await db.query('SELECT COUNT(*) as total FROM activos WHERE clasificacion = "Activo productivo"');
            const [noProductivoRows] = await db.query('SELECT COUNT(*) as total FROM activos WHERE clasificacion = "Activo no productivo"');
            const [conGarantiaRows] = await db.query('SELECT COUNT(*) as total FROM activos WHERE garantia = "Si"');
            const [valorTotalRows] = await db.query('SELECT COALESCE(ROUND(SUM(valor), 0), 0) as valor_total FROM activos WHERE valor IS NOT NULL AND valor > 0');
            const [valorPromedioRows] = await db.query('SELECT COALESCE(ROUND(AVG(valor), 0), 0) as valor_promedio FROM activos WHERE valor IS NOT NULL AND valor > 0');
            const [tipoRows] = await db.query(`
                SELECT
                    SUM(CASE WHEN tipo = 'activo' THEN 1 ELSE 0 END) AS total_activos_contables,
                    SUM(CASE WHEN tipo = 'gasto'  THEN 1 ELSE 0 END) AS total_gastos
                FROM activos
            `);

            return {
                total: totalRows[0].total,
                activos_productivos: productivoRows[0].total,
                activos_no_productivos: noProductivoRows[0].total,
                con_garantia: conGarantiaRows[0].total,
                valor_total: parseInt(valorTotalRows[0].valor_total),
                valor_promedio: parseInt(valorPromedioRows[0].valor_promedio),
                total_activos_contables: parseInt(tipoRows[0].total_activos_contables || 0),
                total_gastos: parseInt(tipoRows[0].total_gastos || 0)
            };
        } catch (error) {
            throw error;
        }
    }

    // Método para buscar por número de placa con tolerancia a formatos
    static async getByNumeroPlaca(numeroPlaca) {
        try {
            const normalizedSearch = numeroPlaca.replace(/'/g, '-');
            const [rows] = await db.query(`
                SELECT 
                    a.*,
                    u.full_name as created_by_name
                FROM activos a
                LEFT JOIN users u ON a.created_by_id = u.id
                WHERE a.numero_placa = ? OR a.numero_placa = ?
            `, [numeroPlaca, normalizedSearch]);
            return rows[0];
        } catch (error) {
            throw error;
        }
    }
}

module.exports = Activo;