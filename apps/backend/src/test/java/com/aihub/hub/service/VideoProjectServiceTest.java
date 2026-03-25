package com.aihub.hub.service;

import com.aihub.hub.domain.video.VideoProject;
import com.aihub.hub.domain.video.VideoScene;
import com.aihub.hub.dto.video.CreateVideoProjectRequest;
import com.aihub.hub.dto.video.CreateVideoProjectRequest.AssetInput;
import com.aihub.hub.dto.video.CreateVideoProjectRequest.SceneInput;
import com.aihub.hub.dto.video.VideoProjectView;
import com.aihub.hub.repository.video.VideoProjectRepository;
import com.aihub.hub.repository.video.VideoSceneRepository;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.context.annotation.Import;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

@DataJpaTest
@Import(VideoProjectService.class)
class VideoProjectServiceTest {

    @Autowired
    private VideoProjectService videoProjectService;

    @Autowired
    private VideoProjectRepository videoProjectRepository;

    @Autowired
    private VideoSceneRepository videoSceneRepository;

    @Test
    void shouldCreateVideoProjectWithScenesAndAssets() {
        CreateVideoProjectRequest request = buildRequest("vid-001");

        VideoProjectView view = videoProjectService.createProject("owner@example.com", request);

        assertThat(view.getCode()).isEqualTo("vid-001");
        assertThat(view.getOwnerEmail()).isEqualTo("owner@example.com");
        assertThat(view.getScenes()).hasSize(2);
        assertThat(view.getAssets()).hasSize(1);
        assertThat(view.getScenes()).extracting(VideoProjectView.SceneView::getSequenceIndex)
            .containsExactly(1, 2);

        VideoProject persisted = videoProjectRepository.findByCode("vid-001").orElseThrow();
        assertThat(persisted.getTitle()).isEqualTo("Vídeo de vendas Demo");

        List<VideoScene> scenes = videoSceneRepository.findByProjectIdOrderBySequenceIndexAsc(persisted.getId());
        assertThat(scenes).hasSize(2);
        assertThat(scenes).extracting(VideoScene::getSequenceIndex).containsExactly(1, 2);
        assertThat(scenes).extracting(VideoScene::getScript)
            .containsExactly("Abertura do vídeo", "Detalhes do produto");
    }

    @Test
    void shouldRejectDuplicatedCode() {
        CreateVideoProjectRequest first = buildRequest("vid-duplicate");
        videoProjectService.createProject("owner@example.com", first);

        CreateVideoProjectRequest duplicate = buildRequest("vid-duplicate");
        assertThatThrownBy(() -> videoProjectService.createProject("another@example.com", duplicate))
            .isInstanceOf(IllegalStateException.class)
            .hasMessageContaining("Código de projeto já está em uso");
    }

    private CreateVideoProjectRequest buildRequest(String code) {
        CreateVideoProjectRequest request = new CreateVideoProjectRequest();
        request.setCode(code);
        request.setTitle("Vídeo de vendas Demo");
        request.setProductName("Produto XPTO");
        request.setStatus("draft");
        request.setLanguage("pt-BR");
        request.setTargetAudience("Pequenas empresas");
        request.setPrimaryGoal("Gerar leads qualificados");
        request.setCallToActionUrl("https://exemplo.com/cta");

        SceneInput scene1 = new SceneInput();
        scene1.setSequenceIndex(1);
        scene1.setTitle("Abertura");
        scene1.setScript("Abertura do vídeo");
        scene1.setVisualStyle("studio");

        SceneInput scene2 = new SceneInput();
        scene2.setSequenceIndex(2);
        scene2.setTitle("Benefícios");
        scene2.setScript("Detalhes do produto");
        scene2.setVisualStyle("close-up");

        request.setScenes(List.of(scene1, scene2));

        AssetInput asset = new AssetInput();
        asset.setType("image");
        asset.setLabel("Hero");
        asset.setSource("https://exemplo.com/hero.png");

        request.setAssets(List.of(asset));
        return request;
    }
}
