import { Channel } from "https://cdn.jsdelivr.net/npm/bridge-iframe-api@0.4.11/dist/bridge-iframe-api.es.js"

const api = new Channel()

window.bridge = {
    connected: false,
    writeFile: () => {}
}


async function connectToBridge() {
    api.on('app.buildInfo', data => console.log(data))
    
    api.on('tab.openFile', async ({ fileReference, filePath }) => {
        console.log(fileReference)
        const fileContent = await api.trigger('fs.readTextFile', fileReference)
    
        // Load other connected files such as textures and animations after model was parsed
        // TODO: Clear listener which didn't trigger, otherwise it will be called multiple times
        Codecs.bedrock.once('parsed', () => loadConnectedTexture())
        Codecs.bedrock_old.once('parsed', () => loadConnectedTexture())        

        // Load in model
        loadModelFile({ content: fileContent, path: filePath })
    })

    await api.connect()
    window.bridge = {
        connected: true,
        writeFile: (filePath, data) => api.trigger('fs.writeFile', {filePath, data})
    }

    // Sync unsaved status
    Blockbench.on('saved_state_changed', async () => {
        const hasUnsavedProjects = ModelProject.all.find(project => !project.saved) !== undefined;

        await api.trigger('tab.setIsUnsaved', hasUnsavedProjects)
    })
}

if(window.top) await connectToBridge()


async function loadConnectedTexture() {
    const geometryId = `geometry.${Project.model_identifier}`
    const clientEntity = await findClientEntity(geometryId)
    console.log(clientEntity)
    
    if(clientEntity) {
        // Load textures
        const textures = await Promise.all(
            clientEntity.texturePath.map(
                async texturePath => [
                    texturePath,
                    await api.trigger('fs.readAsDataUrl', texturePath)
                        .catch((err) => {
                            console.error(`Failed to load texture: ${err}`)
                            return null
                        })
                ]
            )
        )

        textures.forEach(([texturePath, dataUrl]) => new Texture().fromFile({content: dataUrl, path: texturePath}).add().fillParticle())

        // Load animations
        const animationIds = clientEntity.animationIdentifier.filter(id => id.startsWith('animation.'))
        const animationPaths = await api.trigger('packIndexer.find', { findFileType: 'clientAnimation', whereCacheKey: 'identifier', matchesOneOf: animationIds, fetchAll: true })

        const animationData = await Promise.all(
            animationPaths.map(
                async animationPath => [
                    animationPath,
                    await api.trigger('fs.readTextFile', animationPath)
                        .catch((err) => {
                            console.error(`Failed to load animation: ${err}`)
                            return null
                        }
                    )
                ]
            )
        )

        animationData.forEach(([animationPath, animationContent]) => {
            Animator.loadFile({ path: animationPath, content: animationContent }, animationIds)
        })
    }

    // TODO: Support loading block textures
}

async function findClientEntity(geometryId) {
    const clientEntities = await api.trigger('packIndexer.find', { findFileType: 'clientEntity', whereCacheKey: 'geometryIdentifier', matchesOneOf: [geometryId], fetchAll: false })
    if(clientEntities.length === 0) return null

    const clientEntityPath = clientEntities[0]
    const data = await api.trigger('packIndexer.getFile', clientEntityPath)
    return data
}

