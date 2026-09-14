package com.aihub.hub.service;

import com.aihub.hub.domain.ProcessRecord;
import com.aihub.hub.dto.ProcessRequest;
import com.aihub.hub.dto.ProcessView;
import com.aihub.hub.repository.ProcessRepository;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;
import java.util.List;
import java.util.regex.Pattern;

@Service
public class ProcessService {
    private static final Pattern SUBPROCESS_SUFFIX = Pattern.compile("[1-9]\\d*");
    private final ProcessRepository repository;
    public ProcessService(ProcessRepository repository) { this.repository = repository; }
    @Transactional(readOnly = true) public List<ProcessView> list() { return repository.findAllByOrderByNumberAsc().stream().map(this::view).toList(); }
    @Transactional public ProcessView create(ProcessRequest request) { return save(new ProcessRecord(), request, null); }
    @Transactional public ProcessView update(Long id, ProcessRequest request) { return save(repository.findById(id).orElseThrow(() -> notFound()), request, id); }
    @Transactional public void delete(Long id) {
        if (!repository.existsById(id)) throw notFound();
        if (repository.existsByParentProcessId(id)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Exclua ou desvincule os subprocessos antes de excluir o processo principal");
        }
        repository.deleteById(id);
    }
    private ProcessView save(ProcessRecord record, ProcessRequest request, Long id) {
        String number = request.number().trim();
        boolean duplicate = id == null ? repository.existsByNumberIgnoreCase(number) : repository.existsByNumberIgnoreCaseAndIdNot(number, id);
        if (duplicate) throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Já existe um processo com este número");
        if (id != null && !record.getNumber().equalsIgnoreCase(number) && repository.existsByParentProcessId(id)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "O número de um processo com subprocessos vinculados não pode ser alterado");
        }
        ProcessRecord parent = resolveParent(request.parentProcessId(), id);
        validateSubprocessNumber(number, parent);
        record.setNumber(number);
        record.setText(request.text().trim());
        record.setParentProcess(parent);
        return view(repository.save(record));
    }
    private ProcessRecord resolveParent(Long parentId, Long currentId) {
        if (parentId == null) return null;
        if (parentId.equals(currentId)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Um processo não pode ser subprocesso dele mesmo");
        }
        ProcessRecord parent = repository.findById(parentId).orElseThrow(() ->
            new ResponseStatusException(HttpStatus.BAD_REQUEST, "Processo principal não encontrado"));
        if (parent.getParentProcess() != null) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Selecione um processo principal, não outro subprocesso");
        }
        return parent;
    }
    private void validateSubprocessNumber(String number, ProcessRecord parent) {
        if (parent == null) return;
        String prefix = parent.getNumber() + ".";
        String suffix = number.startsWith(prefix) ? number.substring(prefix.length()) : "";
        if (!SUBPROCESS_SUFFIX.matcher(suffix).matches()) {
            throw new ResponseStatusException(
                HttpStatus.BAD_REQUEST,
                "O número do subprocesso deve seguir o formato " + prefix + "1"
            );
        }
    }
    private ResponseStatusException notFound() { return new ResponseStatusException(HttpStatus.NOT_FOUND, "Processo não encontrado"); }
    private ProcessView view(ProcessRecord value) {
        ProcessRecord parent = value.getParentProcess();
        return new ProcessView(
            value.getId(), value.getNumber(), value.getText(),
            parent == null ? null : parent.getId(), parent == null ? null : parent.getNumber(),
            value.getCreatedAt(), value.getUpdatedAt()
        );
    }
}
